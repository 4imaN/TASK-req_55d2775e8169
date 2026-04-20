"""
Unit tests for the encryption module (AES-256-GCM round-trip).

Run with:
    pytest apps/vision-worker/tests/test_encryption.py -v
"""

import os
import sys

# Ensure src/ is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# Provide a valid 64-hex test key before importing the module
os.environ.setdefault('ENCRYPTION_KEY', 'a' * 64)

import base64
import importlib

import numpy as np
import pytest


# ---------------------------------------------------------------------------
# Reload encryption module with a known test key
# ---------------------------------------------------------------------------

TEST_KEY_HEX = 'deadbeef' * 8  # 32 bytes

def _load_encryption_module(key_hex: str):
    """Import (or reload) the encryption module with the given key."""
    os.environ['ENCRYPTION_KEY'] = key_hex
    # Remove cached modules so config and encryption are reloaded fresh
    for mod_name in list(sys.modules.keys()):
        if mod_name in ('config', 'encryption'):
            del sys.modules[mod_name]
    import encryption as enc_mod
    return enc_mod


enc = _load_encryption_module(TEST_KEY_HEX)


# ---------------------------------------------------------------------------
# Round-trip tests
# ---------------------------------------------------------------------------

class TestEncryptionRoundTrip:
    def test_encrypt_decrypt_float32_vector(self):
        """Basic round-trip: encrypt then decrypt recovers the original array."""
        original = np.random.randn(256).astype(np.float32)
        encrypted = enc.encrypt_embedding(original)
        recovered = enc.decrypt_embedding(encrypted)
        np.testing.assert_array_almost_equal(original, recovered, decimal=6)

    def test_encrypt_produces_string(self):
        v = np.ones(64, dtype=np.float32)
        result = enc.encrypt_embedding(v)
        assert isinstance(result, str), "Encrypted result must be a string"

    def test_encrypt_produces_valid_base64(self):
        v = np.zeros(64, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        # Should not raise
        raw = base64.b64decode(encrypted)
        # 12 (nonce) + 16 (tag) + len(v)*4 (float32) = 28 + 256 = 284
        assert len(raw) == 12 + 16 + 64 * 4

    def test_different_plaintexts_different_ciphertext(self):
        v1 = np.random.randn(64).astype(np.float32)
        v2 = np.random.randn(64).astype(np.float32)
        c1 = enc.encrypt_embedding(v1)
        c2 = enc.encrypt_embedding(v2)
        assert c1 != c2

    def test_same_plaintext_different_nonces(self):
        """Each call must produce a different ciphertext (random nonce)."""
        v = np.ones(64, dtype=np.float32)
        c1 = enc.encrypt_embedding(v)
        c2 = enc.encrypt_embedding(v)
        assert c1 != c2, "Nonce must be random; same plaintext must produce different ciphertext"

    def test_various_embedding_sizes(self):
        for dim in (64, 128, 256, 512, 2048):
            original = np.random.randn(dim).astype(np.float32)
            encrypted = enc.encrypt_embedding(original)
            recovered = enc.decrypt_embedding(encrypted, expected_length=dim)
            assert recovered.shape == original.shape
            np.testing.assert_array_almost_equal(original, recovered, decimal=6)

    def test_zeros_vector(self):
        v = np.zeros(128, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        recovered = enc.decrypt_embedding(encrypted)
        np.testing.assert_array_equal(v, recovered)

    def test_float32_precision_preserved(self):
        v = np.array([1.23456789, -0.98765432, 0.00000001], dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        recovered = enc.decrypt_embedding(encrypted)
        np.testing.assert_array_almost_equal(v, recovered, decimal=6)


# ---------------------------------------------------------------------------
# Authentication / tamper detection
# ---------------------------------------------------------------------------

class TestEncryptionTamperDetection:
    def test_tampered_ciphertext_raises(self):
        v = np.ones(64, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        raw = bytearray(base64.b64decode(encrypted))
        # Flip a byte in the ciphertext body (after nonce + tag area)
        raw[30] ^= 0xFF
        tampered = base64.b64encode(bytes(raw)).decode('ascii')
        with pytest.raises(ValueError, match='Decryption failed'):
            enc.decrypt_embedding(tampered)

    def test_truncated_blob_raises(self):
        v = np.ones(32, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        raw = base64.b64decode(encrypted)
        # Strip most of the blob
        short = base64.b64encode(raw[:5]).decode('ascii')
        with pytest.raises(ValueError):
            enc.decrypt_embedding(short)

    def test_wrong_key_raises(self):
        """Decrypt with a different key must fail authentication."""
        v = np.random.randn(64).astype(np.float32)
        encrypted = enc.encrypt_embedding(v)

        # Load module with different key
        wrong_enc = _load_encryption_module('ff' * 32)
        with pytest.raises(ValueError, match='Decryption failed'):
            wrong_enc.decrypt_embedding(encrypted)

    def test_empty_string_raises(self):
        with pytest.raises(Exception):
            enc.decrypt_embedding('')


# ---------------------------------------------------------------------------
# Length validation
# ---------------------------------------------------------------------------

class TestEncryptionLengthValidation:
    def test_expected_length_match_passes(self):
        v = np.ones(128, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        recovered = enc.decrypt_embedding(encrypted, expected_length=128)
        assert len(recovered) == 128

    def test_expected_length_mismatch_raises(self):
        v = np.ones(128, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        with pytest.raises(ValueError, match='length mismatch'):
            enc.decrypt_embedding(encrypted, expected_length=256)

    def test_expected_length_zero_disables_check(self):
        v = np.ones(64, dtype=np.float32)
        encrypted = enc.encrypt_embedding(v)
        # Should not raise
        recovered = enc.decrypt_embedding(encrypted, expected_length=0)
        assert len(recovered) == 64


# ---------------------------------------------------------------------------
# Invalid key configuration
# ---------------------------------------------------------------------------

class TestEncryptionKeyValidation:
    def test_short_key_raises_on_import(self):
        with pytest.raises((ValueError, Exception)):
            _load_encryption_module('aabbcc')  # Too short

    def test_odd_length_hex_raises_on_import(self):
        with pytest.raises(Exception):
            _load_encryption_module('a' * 63)  # Odd hex length
