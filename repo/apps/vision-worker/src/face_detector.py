"""
StudyRoomOps Vision Worker - Face Detection Module

Provides three public functions:
    detect_faces(frame)             -> list of (bbox, landmarks, embedding) tuples
    align_face(frame, landmarks)    -> aligned face crop (numpy array)
    extract_embedding(aligned_face) -> 1-D numpy float32 feature vector

Backend selection is controlled by DETECTOR_BACKEND env var ('haar' | 'dnn').

Notes:
- No raw face images are stored or returned to callers.
- Embeddings are returned as plain numpy arrays; callers are responsible
  for encrypting before persisting.
"""

import logging
import os
import warnings
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from config import DETECTOR_BACKEND, DNN_CONFIDENCE_GATE

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

BBox = Dict[str, int]       # {'x': int, 'y': int, 'w': int, 'h': int}
Landmarks = Dict[str, Tuple[int, int]]  # keyed by landmark name
FaceRecord = Tuple[BBox, Landmarks, np.ndarray]

# ---------------------------------------------------------------------------
# Resource paths
# ---------------------------------------------------------------------------

_HERE = Path(__file__).parent
_CASCADE_PATH = str(
    cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
)
_EYE_CASCADE_PATH = str(
    cv2.data.haarcascades + 'haarcascade_eye.xml'
)

# OpenCV DNN face detector (Caffe model shipped with opencv_contrib or user-provided)
_DNN_PROTOTXT = os.environ.get(
    'DNN_PROTOTXT',
    str(_HERE / 'models' / 'deploy.prototxt'),
)
_DNN_CAFFEMODEL = os.environ.get(
    'DNN_CAFFEMODEL',
    str(_HERE / 'models' / 'res10_300x300_ssd_iter_140000.caffemodel'),
)

# ---------------------------------------------------------------------------
# Lazy-loaded detector singletons
# ---------------------------------------------------------------------------

_face_cascade: Optional[cv2.CascadeClassifier] = None
_eye_cascade: Optional[cv2.CascadeClassifier] = None
_dnn_net: Optional[cv2.dnn.Net] = None
_lbph_recognizer: Optional[cv2.face.LBPHFaceRecognizer] = None


def _get_face_cascade() -> cv2.CascadeClassifier:
    global _face_cascade
    if _face_cascade is None:
        _face_cascade = cv2.CascadeClassifier(_CASCADE_PATH)
        if _face_cascade.empty():
            raise RuntimeError(f"Failed to load Haar cascade from: {_CASCADE_PATH}")
    return _face_cascade


def _get_eye_cascade() -> cv2.CascadeClassifier:
    global _eye_cascade
    if _eye_cascade is None:
        _eye_cascade = cv2.CascadeClassifier(_EYE_CASCADE_PATH)
    return _eye_cascade


def _get_dnn_net() -> Optional[cv2.dnn.Net]:
    global _dnn_net
    if _dnn_net is None:
        if Path(_DNN_PROTOTXT).exists() and Path(_DNN_CAFFEMODEL).exists():
            _dnn_net = cv2.dnn.readNetFromCaffe(_DNN_PROTOTXT, _DNN_CAFFEMODEL)
            logger.info("DNN face detector loaded.")
        else:
            logger.warning(
                "DNN model files not found at %s / %s. "
                "Falling back to Haar cascade.",
                _DNN_PROTOTXT, _DNN_CAFFEMODEL,
            )
    return _dnn_net


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def detect_faces(frame: np.ndarray) -> List[FaceRecord]:
    """
    Detect faces in a BGR frame.

    Returns:
        List of (bbox, landmarks, embedding) tuples.
        bbox = {'x', 'y', 'w', 'h'}
        landmarks = approximate eye centers; more landmarks when available.
        embedding = float32 numpy array.
    """
    if frame is None or frame.size == 0:
        return []

    backend = DETECTOR_BACKEND.lower()
    if backend == 'dnn':
        net = _get_dnn_net()
        if net is not None:
            bboxes = _detect_dnn(frame, net)
        else:
            bboxes = _detect_haar(frame)
    else:
        bboxes = _detect_haar(frame)

    results: List[FaceRecord] = []
    for bbox in bboxes:
        landmarks = _detect_landmarks(frame, bbox)
        aligned = align_face(frame, landmarks, bbox)
        embedding = extract_embedding(aligned)
        results.append((bbox, landmarks, embedding))

    return results


def _detect_haar(frame: np.ndarray) -> List[BBox]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade = _get_face_cascade()
    detections = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(30, 30),
        flags=cv2.CASCADE_SCALE_IMAGE,
    )
    if len(detections) == 0:
        return []
    return [{'x': int(x), 'y': int(y), 'w': int(w), 'h': int(h)}
            for x, y, w, h in detections]


def _detect_dnn(frame: np.ndarray, net: cv2.dnn.Net) -> List[BBox]:
    h, w = frame.shape[:2]
    blob = cv2.dnn.blobFromImage(
        cv2.resize(frame, (300, 300)),
        1.0,
        (300, 300),
        (104.0, 177.0, 123.0),
    )
    net.setInput(blob)
    detections = net.forward()
    bboxes: List[BBox] = []
    for i in range(detections.shape[2]):
        confidence = float(detections[0, 0, i, 2])
        if confidence < DNN_CONFIDENCE_GATE:
            continue
        x1 = max(0, int(detections[0, 0, i, 3] * w))
        y1 = max(0, int(detections[0, 0, i, 4] * h))
        x2 = min(w - 1, int(detections[0, 0, i, 5] * w))
        y2 = min(h - 1, int(detections[0, 0, i, 6] * h))
        bboxes.append({'x': x1, 'y': y1, 'w': x2 - x1, 'h': y2 - y1})
    return bboxes


# ---------------------------------------------------------------------------
# Landmark detection (eye centres via Haar)
# ---------------------------------------------------------------------------

def _detect_landmarks(frame: np.ndarray, bbox: BBox) -> Landmarks:
    """
    Estimate eye-centre landmarks within a face bounding box.
    Returns a dict with 'left_eye' and 'right_eye' (x,y) tuples,
    defaulting to geometric estimates when the cascade finds nothing.
    """
    x, y, w, h = bbox['x'], bbox['y'], bbox['w'], bbox['h']
    face_gray = cv2.cvtColor(
        frame[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY
    )
    eye_cascade = _get_eye_cascade()

    # Default: geometric thirds
    left_eye = (x + w // 4, y + h // 3)
    right_eye = (x + 3 * w // 4, y + h // 3)

    if not eye_cascade.empty():
        eyes = eye_cascade.detectMultiScale(face_gray, scaleFactor=1.1, minNeighbors=5)
        detected = [(int(ex + ew // 2) + x, int(ey + eh // 2) + y)
                    for ex, ey, ew, eh in eyes]
        detected.sort(key=lambda p: p[0])
        if len(detected) >= 2:
            left_eye = detected[0]
            right_eye = detected[-1]
        elif len(detected) == 1:
            left_eye = detected[0]

    return {
        'left_eye': left_eye,
        'right_eye': right_eye,
        'nose_tip': (x + w // 2, y + int(h * 0.6)),
        'mouth_center': (x + w // 2, y + int(h * 0.8)),
    }


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

_ALIGNED_SIZE = 112  # standard for face recognition


def align_face(
    frame: np.ndarray,
    landmarks: Landmarks,
    bbox: Optional[BBox] = None,
) -> np.ndarray:
    """
    Align a face crop using the two eye landmarks.

    Returns:
        BGR numpy array of shape (112, 112, 3).
    """
    lx, ly = landmarks['left_eye']
    rx, ry = landmarks['right_eye']

    # Angle between eyes
    dy = ry - ly
    dx = rx - lx
    angle = float(np.degrees(np.arctan2(dy, dx)))

    eye_center = ((lx + rx) // 2, (ly + ry) // 2)
    rot_mat = cv2.getRotationMatrix2D(eye_center, angle, 1.0)
    aligned_frame = cv2.warpAffine(
        frame, rot_mat, (frame.shape[1], frame.shape[0]),
        flags=cv2.INTER_LINEAR,
    )

    if bbox is not None:
        x, y, w, h = bbox['x'], bbox['y'], bbox['w'], bbox['h']
        # Expand crop slightly for better context
        pad = int(min(w, h) * 0.1)
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(aligned_frame.shape[1], x + w + pad)
        y2 = min(aligned_frame.shape[0], y + h + pad)
        crop = aligned_frame[y1:y2, x1:x2]
    else:
        crop = aligned_frame

    if crop.size == 0:
        crop = frame  # fallback: use original

    return cv2.resize(crop, (_ALIGNED_SIZE, _ALIGNED_SIZE))


# ---------------------------------------------------------------------------
# Embedding extraction
# ---------------------------------------------------------------------------

# LBP histogram bins: (grid_x=8, grid_y=8, radius=1, neighbors=8)
# Results in a 59*8*8 = 3776-dimensional LBP histogram per face.
# We normalise to unit length for cosine similarity comparisons.

_LBP_GRID_X = 8
_LBP_GRID_Y = 8


def extract_embedding(aligned_face: np.ndarray) -> np.ndarray:
    """
    Extract a normalised LBP histogram embedding from an aligned face crop.

    Returns:
        float32 numpy array, L2-normalised, shape (n_features,).
    """
    if aligned_face is None or aligned_face.size == 0:
        return np.zeros(0, dtype=np.float32)

    gray = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY) \
        if aligned_face.ndim == 3 else aligned_face.copy()
    gray = cv2.resize(gray, (_ALIGNED_SIZE, _ALIGNED_SIZE))

    h, w = gray.shape
    cell_h = h // _LBP_GRID_Y
    cell_w = w // _LBP_GRID_X

    histograms: List[np.ndarray] = []
    for row in range(_LBP_GRID_Y):
        for col in range(_LBP_GRID_X):
            cell = gray[
                row * cell_h:(row + 1) * cell_h,
                col * cell_w:(col + 1) * cell_w,
            ]
            lbp = _compute_lbp(cell)
            hist, _ = np.histogram(lbp.ravel(), bins=256, range=(0, 256))
            histograms.append(hist.astype(np.float32))

    embedding = np.concatenate(histograms)

    # L2 normalise
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding /= norm

    return embedding.astype(np.float32)


def _compute_lbp(gray_cell: np.ndarray) -> np.ndarray:
    """Compute LBP codes for a grayscale image patch."""
    rows, cols = gray_cell.shape
    lbp = np.zeros_like(gray_cell, dtype=np.uint8)

    # 8-neighbour LBP (P=8, R=1) using array slicing
    neighbours = [
        gray_cell[0:rows - 2, 0:cols - 2],   # top-left
        gray_cell[0:rows - 2, 1:cols - 1],   # top
        gray_cell[0:rows - 2, 2:cols],         # top-right
        gray_cell[1:rows - 1, 2:cols],         # right
        gray_cell[2:rows, 2:cols],             # bottom-right
        gray_cell[2:rows, 1:cols - 1],        # bottom
        gray_cell[2:rows, 0:cols - 2],        # bottom-left
        gray_cell[1:rows - 1, 0:cols - 2],   # left
    ]
    center = gray_cell[1:rows - 1, 1:cols - 1]

    for bit, nb in enumerate(neighbours):
        lbp[1:rows - 1, 1:cols - 1] += ((nb >= center).astype(np.uint8) << bit)

    return lbp
