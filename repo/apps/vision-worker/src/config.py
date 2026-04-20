"""
StudyRoomOps Vision Worker - Configuration
All settings sourced from environment variables with safe defaults.
"""

import os

# -------------------------------------------------------------------
# Face recognition thresholds
# -------------------------------------------------------------------

# Primary cosine-similarity threshold: scores >= this are a match
FACE_CONFIDENCE_THRESHOLD: float = float(
    os.environ.get('FACE_CONFIDENCE_THRESHOLD', '0.82')
)

# If two candidates are within this margin of the best score, call it ambiguous
AMBIGUOUS_MATCH_MARGIN: float = 0.03

# Minimum number of enrollment image samples required
MIN_ENROLLMENT_SAMPLES: int = 3

# Extra margin added on top of the threshold when auto-checking in
AUTO_CHECKIN_THRESHOLD_BONUS: float = 0.05

# -------------------------------------------------------------------
# Data retention
# -------------------------------------------------------------------

FACE_EVENT_RETENTION_DAYS: int = int(
    os.environ.get('FACE_EVENT_RETENTION_DAYS', '30')
)

# -------------------------------------------------------------------
# Infrastructure
# -------------------------------------------------------------------

MONGO_URI: str = os.environ.get(
    'MONGO_URI', 'mongodb://localhost:27017/studyroomops'
)

MONGO_DB_NAME: str = os.environ.get('MONGO_DB_NAME', 'studyroomops')

# AES-256-GCM key must be exactly 32 bytes, hex-encoded (64 hex chars)
ENCRYPTION_KEY_HEX: str = os.environ.get(
    'ENCRYPTION_KEY',
    # Default is a dummy key ONLY for local dev; must be overridden in production
    '0' * 64,
)

# Vision worker HTTP port
VISION_PORT: int = int(os.environ.get('VISION_PORT', '5000'))

# -------------------------------------------------------------------
# OpenCV / detector settings
# -------------------------------------------------------------------

# Use 'dnn' (more accurate) or 'haar' (lighter)
DETECTOR_BACKEND: str = os.environ.get('DETECTOR_BACKEND', 'haar')

# DNN confidence gate (pre-NMS, only used with backend='dnn')
DNN_CONFIDENCE_GATE: float = float(
    os.environ.get('DNN_CONFIDENCE_GATE', '0.5')
)
