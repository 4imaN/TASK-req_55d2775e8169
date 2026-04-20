"""
StudyRoomOps Vision Worker - Local Face Detection, Recognition, and Access Oversight

Flask service that:
  - Detects faces in camera frames
  - Enrolls face embeddings (AES-256-GCM encrypted) for known users
  - Recognises visitors against the enrolled set
  - Logs face events with a 30-day TTL
  - Manages camera device registry

Privacy guarantees:
  - Raw images are NEVER stored; they are discarded immediately after
    embedding extraction.
  - Embeddings are encrypted with AES-256-GCM before MongoDB persistence.
  - Embeddings are NEVER returned in API responses.
"""

import base64
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from bson import ObjectId
from flask import Flask, jsonify, request

import db as database
from config import (
    AMBIGUOUS_MATCH_MARGIN,
    AUTO_CHECKIN_THRESHOLD_BONUS,
    FACE_CONFIDENCE_THRESHOLD,
    FACE_EVENT_RETENTION_DAYS,
    MIN_ENROLLMENT_SAMPLES,
    VISION_PORT,
)
from encryption import decrypt_embedding, encrypt_embedding
from face_detector import detect_faces, extract_embedding, align_face
from face_matcher import compare_embeddings, make_decision, smooth_decisions, DecisionTracker

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [vision] %(message)s',
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB upload cap

# ---------------------------------------------------------------------------
# In-memory temporal-smoothing trackers: {track_id: DecisionTracker}
# ---------------------------------------------------------------------------

_trackers: Dict[str, DecisionTracker] = {}


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

_INTERNAL_API_KEY: str = os.environ.get('INTERNAL_API_KEY', '')


@app.before_request
def check_internal_auth():
    """Enforce internal API key on all endpoints except /health."""
    if request.path == '/health':
        return  # health check is unauthenticated

    if not _INTERNAL_API_KEY:
        # Key not configured — block all requests to prevent accidental open access
        logger.warning("INTERNAL_API_KEY is not set; rejecting request to %s", request.path)
        return jsonify({'ok': False, 'error': {'code': 'UNAUTHORIZED', 'message': 'Internal API key not configured.'}}), 401

    provided_key = request.headers.get('X-Internal-Api-Key', '')
    if provided_key != _INTERNAL_API_KEY:
        logger.warning("Invalid X-Internal-Api-Key on request to %s", request.path)
        return jsonify({'ok': False, 'error': {'code': 'UNAUTHORIZED', 'message': 'Invalid internal API key.'}}), 401


@app.before_request
def ensure_db():
    """Lazily ensure MongoDB is connected on the first request."""
    try:
        database.connect()
    except Exception as exc:
        logger.error("MongoDB connection failed: %s", exc)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.route('/health', methods=['GET'])
def health():
    """Health check with configuration summary."""
    try:
        database.get_db().command('ping')
        db_ok = True
    except Exception:
        db_ok = False

    return jsonify({
        'ok': True,
        'service': 'studyroomops-vision-worker',
        'timestamp': _now_iso(),
        'db_connected': db_ok,
        'config': {
            'confidence_threshold': FACE_CONFIDENCE_THRESHOLD,
            'ambiguous_match_margin': AMBIGUOUS_MATCH_MARGIN,
            'min_enrollment_samples': MIN_ENROLLMENT_SAMPLES,
            'auto_checkin_threshold_bonus': AUTO_CHECKIN_THRESHOLD_BONUS,
            'face_event_retention_days': FACE_EVENT_RETENTION_DAYS,
        },
    })


# ---------------------------------------------------------------------------
# POST /api/v1/vision/detect
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/detect', methods=['POST'])
def detect():
    """
    Detect faces in a provided image frame.

    Request: multipart/form-data with field 'frame' (image file).
    Optional field 'track_id' for temporal smoothing context.

    Response: bounding boxes, landmark positions (no images, no embeddings).
    """
    t0 = time.perf_counter()

    if 'frame' not in request.files:
        return _error(400, 'MISSING_FIELD', 'Multipart field "frame" is required.')

    file = request.files['frame']
    track_id = request.form.get('track_id')

    try:
        frame = _decode_image_file(file)
    except Exception as exc:
        return _error(400, 'INVALID_IMAGE', f'Cannot decode image: {exc}')

    try:
        face_records = detect_faces(frame)
    except Exception as exc:
        logger.exception("Face detection error")
        return _error(500, 'DETECTION_ERROR', str(exc))

    faces_out = []
    for bbox, landmarks, _embedding in face_records:
        # Serialise landmarks: convert tuple coords to lists for JSON
        lm_serialised = {k: list(v) for k, v in landmarks.items()}
        faces_out.append({
            'bbox': bbox,
            'landmarks': lm_serialised,
        })

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return jsonify({
        'ok': True,
        'data': {
            'faces': faces_out,
            'face_count': len(faces_out),
            'track_id': track_id,
            'processing_ms': elapsed_ms,
        },
    })


# ---------------------------------------------------------------------------
# POST /api/v1/vision/enroll
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/enroll', methods=['POST'])
def enroll():
    """
    Enroll face embeddings for a user.

    Request JSON:
        user_id          (str, required)
        image_samples    (list[str], required) – base64-encoded image data,
                         minimum 3 samples
        consent_metadata (dict, required) – must contain:
            consent_given (bool), consent_timestamp (ISO str), consent_actor (str)
        overwrite        (bool, optional) – if true, replace existing enrollment

    The raw image samples are decoded, embeddings extracted, then discarded.
    Only AES-256-GCM encrypted embeddings are stored in MongoDB.
    """
    body = request.get_json(silent=True) or {}

    user_id = body.get('user_id', '').strip()
    image_samples: List[str] = body.get('image_samples', [])
    consent_metadata: dict = body.get('consent_metadata', {})
    overwrite: bool = bool(body.get('overwrite', False))

    # Validate
    if not user_id:
        return _error(400, 'MISSING_FIELD', '"user_id" is required.')
    if not isinstance(image_samples, list) or len(image_samples) < MIN_ENROLLMENT_SAMPLES:
        return _error(
            400, 'INSUFFICIENT_SAMPLES',
            f'Minimum {MIN_ENROLLMENT_SAMPLES} image samples required; '
            f'got {len(image_samples)}.',
        )
    if not consent_metadata.get('consent_given'):
        return _error(400, 'CONSENT_REQUIRED', 'Explicit consent is required for enrollment.')

    # Extract embeddings from each sample — discard raw images immediately
    embeddings: List[np.ndarray] = []
    for idx, b64_img in enumerate(image_samples):
        try:
            frame = _decode_base64_image(b64_img)
        except Exception as exc:
            return _error(400, 'INVALID_IMAGE', f'Sample {idx}: cannot decode image: {exc}')

        face_records = detect_faces(frame)
        if not face_records:
            return _error(
                422, 'NO_FACE_DETECTED',
                f'Sample {idx}: no face detected. Ensure the image shows a clear frontal face.',
            )
        if len(face_records) > 1:
            return _error(
                422, 'MULTIPLE_FACES',
                f'Sample {idx}: multiple faces detected. Each sample must contain exactly one face.',
            )

        _, _, emb = face_records[0]
        if emb.size == 0:
            return _error(422, 'EMBEDDING_FAILED', f'Sample {idx}: embedding extraction failed.')

        embeddings.append(emb)
        # Raw frame is now unreferenced – GC will collect it

    if not embeddings:
        return _error(422, 'EMBEDDING_FAILED', 'No valid embeddings could be extracted.')

    # Compute mean embedding across samples for a robust template
    mean_emb = np.mean(np.stack(embeddings), axis=0).astype(np.float32)
    # Re-normalise
    norm = np.linalg.norm(mean_emb)
    if norm > 0:
        mean_emb /= norm

    # Encrypt before storage
    try:
        encrypted = encrypt_embedding(mean_emb)
    except Exception as exc:
        logger.exception("Encryption error during enrollment")
        return _error(500, 'ENCRYPTION_ERROR', str(exc))

    col = database.face_enrollments()

    # Handle overwrite
    if overwrite:
        col.delete_many({'userId': user_id})

    enrollment_doc = {
        'userId': user_id,
        'encryptedEmbedding': encrypted,  # base64(AES-256-GCM blob)
        'embeddingDim': int(mean_emb.shape[0]),
        'sampleCount': len(embeddings),
        'status': 'active',
        'consentMetadata': {
            'consentGiven': bool(consent_metadata.get('consent_given')),
            'consentTimestamp': consent_metadata.get('consent_timestamp', _now_iso()),
            'consentActor': consent_metadata.get('consent_actor', ''),
        },
        'enrolledAt': datetime.now(timezone.utc),
        'updatedAt': datetime.now(timezone.utc),
    }

    result = col.insert_one(enrollment_doc)
    enrollment_id = str(result.inserted_id)

    logger.info("Face enrolled for user %s (enrollment_id=%s)", user_id, enrollment_id)

    return jsonify({
        'ok': True,
        'data': {
            'enrollment_id': enrollment_id,
            'user_id': user_id,
            'sample_count': len(embeddings),
            'status': 'active',
            'enrolled_at': _now_iso(),
        },
    }), 201


# ---------------------------------------------------------------------------
# POST /api/v1/vision/recognize
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/recognize', methods=['POST'])
def recognize():
    """
    Recognise a face against all active enrollments.

    Request JSON:
        image        (str, required) – base64-encoded image
        track_id     (str, optional) – for temporal smoothing; creates tracker if new
        threshold    (float, optional) – override default confidence threshold
        allowlist    (list[str], optional) – user IDs with explicit entry permission
        blocklist    (list[str], optional) – user IDs to always deny
        camera_id    (str, optional) – camera context for event logging

    Response includes decision and confidence; embeddings are NEVER returned.
    """
    body = request.get_json(silent=True) or {}

    b64_image = body.get('image', '').strip()
    track_id: str = body.get('track_id') or str(uuid.uuid4())
    threshold: float = float(body.get('threshold', FACE_CONFIDENCE_THRESHOLD))
    allowlist: List[str] = body.get('allowlist', [])
    blocklist: List[str] = body.get('blocklist', [])
    camera_id: Optional[str] = body.get('camera_id')

    if not b64_image:
        return _error(400, 'MISSING_FIELD', '"image" (base64) is required.')

    try:
        frame = _decode_base64_image(b64_image)
    except Exception as exc:
        return _error(400, 'INVALID_IMAGE', f'Cannot decode image: {exc}')

    # Detect faces
    try:
        face_records = detect_faces(frame)
    except Exception as exc:
        logger.exception("Detection error in recognize")
        return _error(500, 'DETECTION_ERROR', str(exc))

    if not face_records:
        return jsonify({
            'ok': True,
            'data': {
                'decision': 'no_face',
                'matched_user_id': None,
                'confidence': 0.0,
                'track_id': track_id,
                'candidates': [],
            },
        })

    # Use the highest-confidence face (largest area)
    primary_record = max(
        face_records,
        key=lambda r: r[0]['w'] * r[0]['h'],
    )
    _, _, query_embedding = primary_record

    # Load all active enrollments from DB
    enrolled: List[Tuple[str, np.ndarray]] = _load_active_embeddings()

    # Compare
    scores = compare_embeddings(query_embedding, enrolled)

    # Make decision
    decision_result = make_decision(scores, threshold, allowlist, blocklist)
    raw_decision: str = decision_result['decision']

    # Temporal smoothing
    if track_id not in _trackers:
        _trackers[track_id] = DecisionTracker(window=5)
    tracker = _trackers[track_id]
    tracker.push(raw_decision)
    smoothed = tracker.smoothed()

    # Log face event
    try:
        _log_face_event(
            camera_id=camera_id,
            decision=smoothed,
            confidence=decision_result['confidence'],
            matched_user_id=decision_result.get('matched_user_id'),
            track_id=track_id,
        )
    except Exception as exc:
        logger.warning("Failed to log face event: %s", exc)

    # Never expose embeddings or candidates with full scores in production response;
    # only return safe fields.
    return jsonify({
        'ok': True,
        'data': {
            'decision': smoothed,
            'raw_decision': raw_decision,
            'matched_user_id': decision_result.get('matched_user_id'),
            'confidence': round(decision_result['confidence'], 6),
            'track_id': track_id,
            'face_count': len(face_records),
        },
    })


# ---------------------------------------------------------------------------
# GET /api/v1/vision/events
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/events', methods=['GET'])
def list_events():
    """
    List face events with pagination and optional filters.

    Query params:
        page       (int, default 1)
        pageSize   (int, default 20, max 100)
        camera_id  (str, optional)
        decision   (str, optional)
        date_from  (ISO str, optional)
        date_to    (ISO str, optional)
    """
    page = max(1, int(request.args.get('page', 1)))
    page_size = min(100, max(1, int(request.args.get('pageSize', 20))))
    camera_id = request.args.get('camera_id')
    decision_filter = request.args.get('decision')
    date_from_str = request.args.get('date_from')
    date_to_str = request.args.get('date_to')

    query: dict = {}
    if camera_id:
        query['cameraId'] = camera_id
    if decision_filter:
        query['decision'] = decision_filter

    if date_from_str or date_to_str:
        date_q: dict = {}
        if date_from_str:
            date_q['$gte'] = _parse_iso(date_from_str)
        if date_to_str:
            date_q['$lte'] = _parse_iso(date_to_str)
        query['occurredAt'] = date_q

    col = database.face_events()
    total = col.count_documents(query)
    cursor = (
        col.find(query, {'_id': 1, 'cameraId': 1, 'decision': 1,
                         'confidence': 1, 'matchedUserId': 1,
                         'trackId': 1, 'occurredAt': 1})
        .sort('occurredAt', -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )

    events = []
    for doc in cursor:
        events.append({
            'event_id': str(doc['_id']),
            'camera_id': doc.get('cameraId'),
            'decision': doc.get('decision'),
            'confidence': doc.get('confidence'),
            'matched_user_id': doc.get('matchedUserId'),
            'track_id': doc.get('trackId'),
            'occurred_at': _dt_iso(doc.get('occurredAt')),
        })

    return jsonify({
        'ok': True,
        'data': {
            'events': events,
            'total': total,
            'page': page,
            'page_size': page_size,
        },
    })


# ---------------------------------------------------------------------------
# GET /api/v1/vision/cameras
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/cameras', methods=['GET'])
def list_cameras():
    """List all registered camera devices."""
    col = database.camera_devices()
    cameras = []
    for doc in col.find({}, {'encryptedConfig': 0}):
        cameras.append(_serialize_camera(doc))

    return jsonify({
        'ok': True,
        'data': {
            'cameras': cameras,
            'total': len(cameras),
        },
    })


# ---------------------------------------------------------------------------
# POST /api/v1/vision/cameras
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/cameras', methods=['POST'])
def register_camera():
    """
    Register a new camera device.

    Request JSON:
        device_identifier (str, required) – unique hardware ID / MAC
        name              (str, required)
        location          (str, optional)
        zone_id           (str, optional)
        room_id           (str, optional)
        is_active         (bool, default true)
    """
    body = request.get_json(silent=True) or {}

    device_identifier = body.get('device_identifier', '').strip()
    name = body.get('name', '').strip()

    if not device_identifier:
        return _error(400, 'MISSING_FIELD', '"device_identifier" is required.')
    if not name:
        return _error(400, 'MISSING_FIELD', '"name" is required.')

    col = database.camera_devices()
    if col.find_one({'deviceIdentifier': device_identifier}):
        return _error(409, 'CONFLICT', 'A camera with this device_identifier already exists.')

    doc = {
        'deviceIdentifier': device_identifier,
        'name': name,
        'location': body.get('location', ''),
        'zoneId': body.get('zone_id'),
        'roomId': body.get('room_id'),
        'isActive': bool(body.get('is_active', True)),
        'registeredAt': datetime.now(timezone.utc),
        'updatedAt': datetime.now(timezone.utc),
    }

    result = col.insert_one(doc)
    doc['_id'] = result.inserted_id

    return jsonify({
        'ok': True,
        'data': _serialize_camera(doc),
    }), 201


# ---------------------------------------------------------------------------
# PUT /api/v1/vision/cameras/<camera_id>
# ---------------------------------------------------------------------------

@app.route('/api/v1/vision/cameras/<camera_id>', methods=['PUT'])
def update_camera(camera_id: str):
    """
    Update a camera device.

    Request JSON (all optional):
        name, location, zone_id, room_id, is_active
    """
    body = request.get_json(silent=True) or {}

    try:
        oid = ObjectId(camera_id)
    except Exception:
        return _error(400, 'INVALID_ID', 'camera_id is not a valid ObjectId.')

    col = database.camera_devices()
    existing = col.find_one({'_id': oid})
    if not existing:
        return _error(404, 'NOT_FOUND', 'Camera not found.')

    updates: dict = {'updatedAt': datetime.now(timezone.utc)}
    for field, key in [
        ('name', 'name'),
        ('location', 'location'),
        ('zone_id', 'zoneId'),
        ('room_id', 'roomId'),
    ]:
        if field in body:
            updates[key] = body[field]
    if 'is_active' in body:
        updates['isActive'] = bool(body['is_active'])

    col.update_one({'_id': oid}, {'$set': updates})
    updated = col.find_one({'_id': oid}, {'encryptedConfig': 0})

    return jsonify({
        'ok': True,
        'data': _serialize_camera(updated),
    })


# ---------------------------------------------------------------------------
# Internal: temporal smoothing helper (exposed for tests / callers)
# ---------------------------------------------------------------------------

def apply_temporal_smoothing(
    track_id: str,
    new_decision: str,
    window: int = 5,
) -> str:
    """
    Push a new decision into the tracker for track_id and return smoothed result.
    Creates a new tracker if track_id has not been seen before.
    """
    if track_id not in _trackers:
        _trackers[track_id] = DecisionTracker(window=window)
    tracker = _trackers[track_id]
    tracker.push(new_decision)
    return tracker.smoothed()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _decode_image_file(file) -> np.ndarray:
    """Decode an uploaded image file to a BGR numpy array."""
    raw = file.read()
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("OpenCV could not decode the image.")
    return frame


def _decode_base64_image(b64_str: str) -> np.ndarray:
    """Decode a base64-encoded image string to a BGR numpy array."""
    # Strip optional data-URI prefix
    if ',' in b64_str:
        b64_str = b64_str.split(',', 1)[1]
    raw = base64.b64decode(b64_str)
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("OpenCV could not decode the base64 image.")
    return frame


def _load_active_embeddings() -> List[Tuple[str, np.ndarray]]:
    """Load and decrypt all active face enrollments from MongoDB."""
    col = database.face_enrollments()
    result: List[Tuple[str, np.ndarray]] = []

    for doc in col.find({'status': 'active'}, {'userId': 1, 'encryptedEmbedding': 1, 'embeddingDim': 1}):
        user_id = str(doc.get('userId', ''))
        enc = doc.get('encryptedEmbedding', '')
        dim = int(doc.get('embeddingDim', 0))
        if not enc:
            continue
        try:
            emb = decrypt_embedding(enc, expected_length=dim)
            result.append((user_id, emb))
        except Exception as exc:
            logger.warning(
                "Failed to decrypt embedding for user %s: %s", user_id, exc
            )

    return result


def _log_face_event(
    camera_id: Optional[str],
    decision: str,
    confidence: float,
    matched_user_id: Optional[str],
    track_id: str,
) -> None:
    """Persist a face event document with a TTL expiry."""
    now = datetime.now(timezone.utc)
    doc = {
        'cameraId': camera_id,
        'decision': decision,
        'confidence': round(confidence, 6),
        'matchedUserId': matched_user_id,
        'trackId': track_id,
        'occurredAt': now,
        'expiresAt': database.make_face_event_expiry(),
    }
    database.face_events().insert_one(doc)


def _serialize_camera(doc: dict) -> dict:
    """Convert a camera_devices document to a safe API response dict."""
    return {
        'camera_id': str(doc.get('_id', '')),
        'device_identifier': doc.get('deviceIdentifier', ''),
        'name': doc.get('name', ''),
        'location': doc.get('location', ''),
        'zone_id': doc.get('zoneId'),
        'room_id': doc.get('roomId'),
        'is_active': doc.get('isActive', True),
        'registered_at': _dt_iso(doc.get('registeredAt')),
        'updated_at': _dt_iso(doc.get('updatedAt')),
    }


def _error(status: int, code: str, message: str):
    return jsonify({'ok': False, 'error': {'code': code, 'message': message}}), status


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dt_iso(dt) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _parse_iso(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    logger.info("Starting StudyRoomOps Vision Worker on port %d", VISION_PORT)
    logger.info("Confidence threshold: %.2f", FACE_CONFIDENCE_THRESHOLD)
    database.connect()
    app.run(host='0.0.0.0', port=VISION_PORT, debug=False)
