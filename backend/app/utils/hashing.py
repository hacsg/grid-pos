"""PIN hashing and verification helpers."""

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_pin(pin: str) -> str:
    """Hash a validated four-digit staff PIN."""
    if not pin.isdigit() or len(pin) != 4:
        raise ValueError("PIN must be exactly four digits")
    return pwd_context.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    """Verify a staff PIN against its stored bcrypt hash."""
    if not pin.isdigit() or len(pin) != 4:
        return False
    return pwd_context.verify(pin, pin_hash)

