"""
StudyRoomOps Vision Worker - MongoDB Connection
Provides a thin connection layer and per-collection accessors.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import pymongo
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from config import MONGO_URI, MONGO_DB_NAME, FACE_EVENT_RETENTION_DAYS

logger = logging.getLogger(__name__)

_client: Optional[MongoClient] = None
_db: Optional[Database] = None


def connect() -> Database:
    """Connect to MongoDB and bootstrap required indexes. Idempotent."""
    global _client, _db

    if _db is not None:
        return _db

    logger.info("Connecting to MongoDB at %s", MONGO_URI)
    _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5_000)
    _db = _client[MONGO_DB_NAME]

    _bootstrap_indexes(_db)
    logger.info("MongoDB connected and indexes ready.")
    return _db


def get_db() -> Database:
    if _db is None:
        return connect()
    return _db


def get_collection(name: str) -> Collection:
    """Return a named MongoDB collection, auto-connecting if needed."""
    return get_db()[name]


# ---------------------------------------------------------------------------
# Convenience accessors
# ---------------------------------------------------------------------------

def face_enrollments() -> Collection:
    return get_collection('face_enrollments')


def face_events() -> Collection:
    return get_collection('face_events')


def camera_devices() -> Collection:
    return get_collection('camera_devices')


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _bootstrap_indexes(db: Database) -> None:
    """Create TTL and supporting indexes for vision collections."""

    # Face events: TTL index on expiresAt (value set to zero seconds
    # so MongoDB respects the document-level timestamp directly)
    db['face_events'].create_index(
        [('expiresAt', pymongo.ASCENDING)],
        expireAfterSeconds=0,
        name='idx_face_events_ttl',
    )
    db['face_events'].create_index(
        [('cameraId', pymongo.ASCENDING),
         ('occurredAt', pymongo.DESCENDING),
         ('decision', pymongo.ASCENDING)],
        name='idx_face_events_camera_occurred_decision',
    )

    # Face enrollments
    db['face_enrollments'].create_index(
        [('userId', pymongo.ASCENDING)],
        name='idx_face_enrollments_user',
    )
    db['face_enrollments'].create_index(
        [('userId', pymongo.ASCENDING), ('status', pymongo.ASCENDING)],
        name='idx_face_enrollments_user_status',
    )

    # Camera devices
    db['camera_devices'].create_index(
        [('deviceIdentifier', pymongo.ASCENDING)],
        unique=True,
        name='idx_cameras_device_id',
    )


def make_face_event_expiry() -> datetime:
    """Return the TTL expiry timestamp for a new face event."""
    return datetime.now(timezone.utc) + timedelta(days=FACE_EVENT_RETENTION_DAYS)
