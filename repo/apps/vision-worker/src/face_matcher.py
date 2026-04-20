"""
StudyRoomOps Vision Worker - Face Matching Module

Provides:
    compare_embeddings(query, enrolled_list)  -> list of (user_id, score) sorted by score desc
    make_decision(scores, threshold, allowlist, blocklist) -> decision dict
    smooth_decisions(recent_decisions, window)             -> smoothed decision string
"""

import logging
from collections import Counter, deque
from typing import Dict, List, Optional, Tuple

import numpy as np

from config import FACE_CONFIDENCE_THRESHOLD, AMBIGUOUS_MATCH_MARGIN

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

# (user_id, cosine_similarity_score)
ScorePair = Tuple[str, float]

Decision = str  # 'no_match' | 'match' | 'ambiguous_match' | 'blocklist_match' | 'allowlist_match'


# ---------------------------------------------------------------------------
# Cosine similarity comparison
# ---------------------------------------------------------------------------

def compare_embeddings(
    query_embedding: np.ndarray,
    enrolled_embeddings: List[Tuple[str, np.ndarray]],
) -> List[ScorePair]:
    """
    Compare a query embedding against a list of (user_id, embedding) pairs.

    Uses cosine similarity (dot product of L2-normalised vectors).
    Both the query and enrolled vectors are re-normalised defensively before
    comparison so that callers do not need to pre-normalise.

    Args:
        query_embedding: 1-D float32 numpy array.
        enrolled_embeddings: list of (user_id, float32 array) tuples.

    Returns:
        List of (user_id, score) tuples sorted by descending score.
        Score is in [0.0, 1.0] (cosine similarity, already >=0 for face vectors).
    """
    if query_embedding is None or query_embedding.size == 0:
        return []

    q = _safe_normalize(query_embedding)
    results: List[ScorePair] = []

    for user_id, emb in enrolled_embeddings:
        if emb is None or emb.size == 0:
            continue
        if emb.shape != q.shape:
            # Mismatched dimensionality — skip gracefully
            logger.debug(
                "Embedding shape mismatch for user %s: %s vs %s",
                user_id, emb.shape, q.shape,
            )
            continue
        e = _safe_normalize(emb)
        score = float(np.clip(np.dot(q, e), 0.0, 1.0))
        results.append((user_id, score))

    results.sort(key=lambda x: x[1], reverse=True)
    return results


def _safe_normalize(v: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(v)
    return v / norm if norm > 0 else v


# ---------------------------------------------------------------------------
# Decision logic
# ---------------------------------------------------------------------------

def make_decision(
    scores: List[ScorePair],
    threshold: float = FACE_CONFIDENCE_THRESHOLD,
    allowlist: Optional[List[str]] = None,
    blocklist: Optional[List[str]] = None,
) -> Dict:
    """
    Translate a sorted score list into a single access decision.

    Decision rules (evaluated in priority order):
        1. No candidates or best score < threshold  -> 'no_match'
        2. Best candidate is blocklisted AND >= threshold -> 'blocklist_match'
        3. Multiple candidates within AMBIGUOUS_MATCH_MARGIN of best -> 'ambiguous_match'
        4. Best candidate is allowlisted AND >= threshold -> 'allowlist_match'
        5. Otherwise (matched, not listed)          -> 'match'

    Args:
        scores:     Sorted (user_id, score) list from compare_embeddings().
        threshold:  Minimum cosine similarity to count as a match.
        allowlist:  User IDs that are explicitly approved for entry.
        blocklist:  User IDs that must be denied regardless of score.

    Returns:
        dict with keys:
            decision (str), matched_user_id (str|None), confidence (float),
            candidates (list of dicts)
    """
    allowlist_set = set(allowlist or [])
    blocklist_set = set(blocklist or [])

    if not scores:
        return _no_match_result()

    best_user, best_score = scores[0]

    # Rule 1: below threshold -> no match
    if best_score < threshold:
        return _no_match_result(confidence=best_score)

    # Rule 2: blocklist (deny even on strong match)
    if best_user in blocklist_set:
        return {
            'decision': 'blocklist_match',
            'matched_user_id': best_user,
            'confidence': best_score,
            'candidates': _format_candidates(scores[:5]),
        }

    # Rule 3: ambiguous — multiple candidates within margin
    close_candidates = [
        (uid, sc) for uid, sc in scores
        if sc >= threshold and (best_score - sc) <= AMBIGUOUS_MATCH_MARGIN
    ]
    if len(close_candidates) > 1:
        return {
            'decision': 'ambiguous_match',
            'matched_user_id': None,
            'confidence': best_score,
            'candidates': _format_candidates(close_candidates),
        }

    # Rule 4: allowlist
    if best_user in allowlist_set:
        return {
            'decision': 'allowlist_match',
            'matched_user_id': best_user,
            'confidence': best_score,
            'candidates': _format_candidates(scores[:5]),
        }

    # Rule 5: plain match
    return {
        'decision': 'match',
        'matched_user_id': best_user,
        'confidence': best_score,
        'candidates': _format_candidates(scores[:5]),
    }


def _no_match_result(confidence: float = 0.0) -> Dict:
    return {
        'decision': 'no_match',
        'matched_user_id': None,
        'confidence': confidence,
        'candidates': [],
    }


def _format_candidates(pairs: List[ScorePair]) -> List[Dict]:
    return [{'user_id': uid, 'score': round(sc, 6)} for uid, sc in pairs]


# ---------------------------------------------------------------------------
# Temporal smoothing
# ---------------------------------------------------------------------------

def smooth_decisions(
    recent_decisions: List[str],
    window: int = 5,
) -> str:
    """
    Return the majority decision across the most recent `window` frames.

    Tie-breaking rules (most conservative first):
        - 'blocklist_match' always wins if it appears in the window.
        - 'no_match' beats other ties (fail-safe default).

    Args:
        recent_decisions: List of decision strings, newest at the end.
        window: Number of most-recent decisions to consider.

    Returns:
        The smoothed decision string.
    """
    if not recent_decisions:
        return 'no_match'

    relevant = recent_decisions[-window:]

    # Blocklist override: any blocklist detection in window forces a block
    if 'blocklist_match' in relevant:
        return 'blocklist_match'

    counts = Counter(relevant)
    if not counts:
        return 'no_match'

    most_common = counts.most_common()
    top_count = most_common[0][1]

    # Gather all decisions tied at the top
    tied = [d for d, c in most_common if c == top_count]

    # Priority: no_match > ambiguous_match > match > allowlist_match
    for cautious in ('no_match', 'ambiguous_match'):
        if cautious in tied:
            return cautious

    return tied[0]


# ---------------------------------------------------------------------------
# Frame-level tracker for temporal smoothing
# ---------------------------------------------------------------------------

class DecisionTracker:
    """
    Per-track deque of recent decisions for temporal smoothing.
    Keeps the last `window` decisions and exposes a smoothed result.
    """

    def __init__(self, window: int = 5) -> None:
        self.window = window
        self._buffer: deque = deque(maxlen=window)

    def push(self, decision: str) -> None:
        self._buffer.append(decision)

    def smoothed(self) -> str:
        return smooth_decisions(list(self._buffer), self.window)

    def reset(self) -> None:
        self._buffer.clear()
