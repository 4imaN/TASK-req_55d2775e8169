"""
StudyRoomOps Vision Worker - Encryption Utilities
AES-256-GCM for numpy embedding arrays.

Layout of the encrypted blob stored in MongoDB (all bytes, base64-encoded):
    [12 bytes nonce][16 bytes tag][N bytes ciphertext]
"""

import base64
import logging
import os
from typing import Tuple

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import ENCRYPTION_KEY_HEX

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Key loading
# ---------------------------------------------------------------------------

def _load_key() -> bytes:
    """
    Decode the 32-byte AES-256 key from the hex environment variable.
    Raises ValueError if the key is missing or the wrong length.
    """
    hex_key = ENCRYPTION_KEY_HEX.strip()
    if len(hex_key) != 64:
        raise ValueError(
            "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). "
            f"Got {len(hex_key)} characters."
        )
    return bytes.fromhex(hex_key)


_KEY: bytes = _load_key()
_AESGCM = AESGCM(_KEY)

# Prefix length: nonce(12) + tag(16) prepended in base64 blob
_NONCE_LEN = 12
_TAG_LEN = 16  # AESGCM appends the tag inside the ciphertext output


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def encrypt_embedding(embedding: np.ndarray) -> str:
    """
    Encrypt a numpy float32 embedding array using AES-256-GCM.

    Returns:
        A base64-encoded string containing [nonce(12B) || gcm_ciphertext_with_tag].
    """
    plaintext: bytes = embedding.astype(np.float32).tobytes()
    nonce: bytes = os.urandom(_NONCE_LEN)

    # AESGCM.encrypt returns ciphertext + 16-byte tag appended
    ciphertext_with_tag: bytes = _AESGCM.encrypt(nonce, plaintext, None)

    blob: bytes = nonce + ciphertext_with_tag
    return base64.b64encode(blob).decode('ascii')


def decrypt_embedding(encrypted_b64: str, expected_length: int = 0) -> np.ndarray:
    """
    Decrypt a base64-encoded AES-256-GCM blob back to a numpy float32 array.

    Args:
        encrypted_b64: base64 string produced by encrypt_embedding()
        expected_length: If > 0, validate that the decoded array has this element count.

    Returns:
        numpy float32 array.
    Raises:
        ValueError on authentication failure or shape mismatch.
    """
    blob: bytes = base64.b64decode(encrypted_b64)
    if len(blob) < _NONCE_LEN + _TAG_LEN:
        raise ValueError("Encrypted blob is too short to contain nonce + tag.")

    nonce: bytes = blob[:_NONCE_LEN]
    ciphertext_with_tag: bytes = blob[_NONCE_LEN:]

    try:
        plaintext: bytes = _AESGCM.decrypt(nonce, ciphertext_with_tag, None)
    except Exception as exc:
        raise ValueError(f"Decryption failed (authentication error): {exc}") from exc

    embedding = np.frombuffer(plaintext, dtype=np.float32).copy()

    if expected_length > 0 and len(embedding) != expected_length:
        raise ValueError(
            f"Embedding length mismatch: expected {expected_length}, got {len(embedding)}"
        )

    return embedding
