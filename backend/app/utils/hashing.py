"""PIN hashing and verification helpers.

Uses bcrypt directly instead of passlib because newer bcrypt (>=4.1) removed
the ``__about__`` module that passlib relies on, causing backend-load failures.
"""

import bcrypt


def hash_pin(pin: str) -> str:
    """Hash a validated four-digit staff PIN using bcrypt."""
    if not pin.isdigit() or len(pin) != 4:
        raise ValueError("PIN must be exactly four digits")
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, pin_hash: str) -> bool:
    """Verify a staff PIN against its stored bcrypt hash."""
    if not pin.isdigit() or len(pin) != 4:
        return False
    return bcrypt.checkpw(pin.encode("utf-8"), pin_hash.encode("utf-8"))