"""
Unit tests for the face_matcher module.

Run with:
    pytest apps/vision-worker/tests/test_face_matcher.py -v
"""

import sys
import os

# Ensure src/ is on the path when running from the repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import numpy as np
import pytest

from face_matcher import (
    compare_embeddings,
    make_decision,
    smooth_decisions,
    DecisionTracker,
    _safe_normalize,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _unit_vec(dim: int = 256, seed: int = 0) -> np.ndarray:
    """Return a deterministic, L2-normalised float32 vector."""
    rng = np.random.RandomState(seed)
    v = rng.randn(dim).astype(np.float32)
    return v / np.linalg.norm(v)


def _near_vec(base: np.ndarray, noise: float = 0.01, seed: int = 99) -> np.ndarray:
    """Return a vector very close to `base` (high cosine similarity)."""
    rng = np.random.RandomState(seed)
    perturbed = base + rng.randn(*base.shape).astype(np.float32) * noise
    norm = np.linalg.norm(perturbed)
    return perturbed / norm if norm > 0 else perturbed


def _far_vec(dim: int = 256, seed: int = 42) -> np.ndarray:
    """Return a vector orthogonal-ish to a typical unit vector."""
    rng = np.random.RandomState(seed + 1000)
    v = rng.randn(dim).astype(np.float32)
    return v / np.linalg.norm(v)


# ---------------------------------------------------------------------------
# compare_embeddings
# ---------------------------------------------------------------------------

class TestCompareEmbeddings:
    def test_returns_sorted_by_score_descending(self):
        q = _unit_vec(seed=0)
        close = _near_vec(q, noise=0.01, seed=1)
        far = _far_vec(seed=2)

        enrolled = [('user_close', close), ('user_far', far)]
        scores = compare_embeddings(q, enrolled)

        assert scores[0][0] == 'user_close', "Closest match should be first"
        assert scores[0][1] > scores[1][1], "Scores should be descending"

    def test_empty_enrolled_returns_empty(self):
        q = _unit_vec()
        assert compare_embeddings(q, []) == []

    def test_none_query_returns_empty(self):
        assert compare_embeddings(np.array([]), [('u1', _unit_vec())]) == []

    def test_mismatched_dims_skipped(self):
        q = _unit_vec(dim=256)
        wrong_dim = _unit_vec(dim=128)
        scores = compare_embeddings(q, [('bad_user', wrong_dim)])
        assert scores == []

    def test_identical_embedding_gives_score_near_one(self):
        q = _unit_vec(seed=7)
        scores = compare_embeddings(q, [('self', q.copy())])
        assert len(scores) == 1
        assert scores[0][1] == pytest.approx(1.0, abs=1e-5)

    def test_scores_clamped_to_zero_one(self):
        q = _unit_vec(seed=3)
        enrolled = [('u', _unit_vec(seed=4))]
        scores = compare_embeddings(q, enrolled)
        for _, sc in scores:
            assert 0.0 <= sc <= 1.0


# ---------------------------------------------------------------------------
# make_decision – no_match
# ---------------------------------------------------------------------------

class TestNoMatch:
    def test_no_match_when_empty_scores(self):
        result = make_decision([], threshold=0.82)
        assert result['decision'] == 'no_match'
        assert result['matched_user_id'] is None

    def test_no_match_when_below_threshold(self):
        scores = [('user_a', 0.70), ('user_b', 0.60)]
        result = make_decision(scores, threshold=0.82)
        assert result['decision'] == 'no_match'
        assert result['matched_user_id'] is None

    def test_no_match_confidence_reflected(self):
        scores = [('user_a', 0.55)]
        result = make_decision(scores, threshold=0.82)
        assert result['decision'] == 'no_match'
        assert result['confidence'] == pytest.approx(0.55, abs=1e-6)


# ---------------------------------------------------------------------------
# make_decision – ambiguous_match
# ---------------------------------------------------------------------------

class TestAmbiguousMatch:
    def test_ambiguous_when_two_candidates_close(self):
        # Both above threshold and within AMBIGUOUS_MATCH_MARGIN (0.03)
        scores = [('user_a', 0.90), ('user_b', 0.88)]
        result = make_decision(scores, threshold=0.82)
        assert result['decision'] == 'ambiguous_match'
        assert result['matched_user_id'] is None

    def test_not_ambiguous_when_gap_exceeds_margin(self):
        # Gap of 0.05 > margin 0.03
        scores = [('user_a', 0.90), ('user_b', 0.85)]
        result = make_decision(scores, threshold=0.82)
        # Should resolve to a definite match for user_a
        assert result['decision'] in ('match', 'allowlist_match')
        assert result['matched_user_id'] == 'user_a'

    def test_ambiguous_no_matched_user_id(self):
        scores = [('u1', 0.91), ('u2', 0.90), ('u3', 0.89)]
        result = make_decision(scores, threshold=0.82)
        assert result['decision'] == 'ambiguous_match'
        assert result['matched_user_id'] is None

    def test_second_candidate_below_threshold_not_ambiguous(self):
        # user_b is below threshold; only user_a qualifies
        scores = [('user_a', 0.90), ('user_b', 0.80)]
        result = make_decision(scores, threshold=0.82)
        assert result['decision'] == 'match'


# ---------------------------------------------------------------------------
# make_decision – blocklist_match
# ---------------------------------------------------------------------------

class TestBlocklistMatch:
    def test_blocklist_match_when_user_blocked(self):
        scores = [('bad_actor', 0.95), ('good_user', 0.80)]
        result = make_decision(scores, threshold=0.82, blocklist=['bad_actor'])
        assert result['decision'] == 'blocklist_match'
        assert result['matched_user_id'] == 'bad_actor'

    def test_blocklist_overrides_even_with_single_candidate(self):
        scores = [('villain', 0.99)]
        result = make_decision(scores, threshold=0.82, blocklist=['villain'])
        assert result['decision'] == 'blocklist_match'

    def test_blocklist_not_triggered_below_threshold(self):
        # Score below threshold so no match at all
        scores = [('villain', 0.70)]
        result = make_decision(scores, threshold=0.82, blocklist=['villain'])
        assert result['decision'] == 'no_match'

    def test_blocklist_not_triggered_for_other_users(self):
        scores = [('good_user', 0.95), ('villain', 0.50)]
        result = make_decision(scores, threshold=0.82, blocklist=['villain'])
        # good_user matches; villain is below threshold
        assert result['decision'] in ('match', 'allowlist_match')
        assert result['matched_user_id'] == 'good_user'


# ---------------------------------------------------------------------------
# make_decision – allowlist_match
# ---------------------------------------------------------------------------

class TestAllowlistMatch:
    def test_allowlist_match_when_user_listed(self):
        scores = [('vip_user', 0.90)]
        result = make_decision(scores, threshold=0.82, allowlist=['vip_user'])
        assert result['decision'] == 'allowlist_match'
        assert result['matched_user_id'] == 'vip_user'

    def test_plain_match_when_not_on_either_list(self):
        scores = [('regular_user', 0.90)]
        result = make_decision(scores, threshold=0.82)
        assert result['decision'] == 'match'
        assert result['matched_user_id'] == 'regular_user'

    def test_allowlist_does_not_affect_below_threshold(self):
        scores = [('vip_user', 0.70)]
        result = make_decision(scores, threshold=0.82, allowlist=['vip_user'])
        assert result['decision'] == 'no_match'


# ---------------------------------------------------------------------------
# smooth_decisions
# ---------------------------------------------------------------------------

class TestSmoothDecisions:
    def test_empty_returns_no_match(self):
        assert smooth_decisions([]) == 'no_match'

    def test_majority_match_wins(self):
        decisions = ['match', 'match', 'no_match', 'match', 'no_match']
        assert smooth_decisions(decisions) == 'match'

    def test_blocklist_always_wins_regardless_of_count(self):
        decisions = ['match', 'match', 'match', 'match', 'blocklist_match']
        assert smooth_decisions(decisions) == 'blocklist_match'

    def test_no_match_beats_other_ties(self):
        # 2 x match, 2 x no_match → no_match wins tie
        decisions = ['match', 'no_match', 'match', 'no_match']
        result = smooth_decisions(decisions)
        assert result == 'no_match'

    def test_window_limits_to_most_recent(self):
        # Last 5: all 'no_match', but earlier were 'match'
        decisions = ['match'] * 10 + ['no_match'] * 5
        result = smooth_decisions(decisions, window=5)
        assert result == 'no_match'

    def test_single_decision(self):
        assert smooth_decisions(['allowlist_match']) == 'allowlist_match'

    def test_ambiguous_beats_match_in_tie(self):
        decisions = ['ambiguous_match', 'match', 'ambiguous_match', 'match']
        result = smooth_decisions(decisions)
        assert result == 'no_match' or result == 'ambiguous_match'
        # Primary assertion: must not be 'match' if ambiguous_match tied
        # (no_match is more conservative; ambiguous_match is also acceptable)
        assert result != 'match'


# ---------------------------------------------------------------------------
# DecisionTracker
# ---------------------------------------------------------------------------

class TestDecisionTracker:
    def test_push_and_smooth(self):
        tracker = DecisionTracker(window=3)
        tracker.push('match')
        tracker.push('match')
        tracker.push('no_match')
        assert tracker.smoothed() == 'match'

    def test_blocklist_propagates_through_tracker(self):
        tracker = DecisionTracker(window=5)
        for _ in range(4):
            tracker.push('match')
        tracker.push('blocklist_match')
        assert tracker.smoothed() == 'blocklist_match'

    def test_reset_clears_history(self):
        tracker = DecisionTracker(window=5)
        for _ in range(5):
            tracker.push('match')
        tracker.reset()
        assert tracker.smoothed() == 'no_match'

    def test_window_maxlen_respected(self):
        tracker = DecisionTracker(window=3)
        for _ in range(10):
            tracker.push('no_match')
        tracker.push('match')
        tracker.push('match')
        tracker.push('match')
        # Only last 3 visible: all 'match'
        assert tracker.smoothed() == 'match'
