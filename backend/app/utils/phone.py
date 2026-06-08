"""Singapore phone number utilities for loyalty system.

Matches Plotholders phone handling so cross-system lookups work.
Phones are stored and exchanged in E.164 format: +65XXXXXXXX
"""

import re

_SG_COUNTRY_CODE = "+65"
_SG_PHONE_LENGTH = 8
_VALID_PREFIXES = ("8", "9")


def _strip_non_digits(s: str) -> str:
    """Remove all non-digit characters from a string."""
    return re.sub(r"\D", "", s)


def normalize_sg_phone(phone: str, country_code: str = "+65") -> str:
    """Normalize a phone number to E.164 Singapore format.

    Strips spaces, dashes, and other non-digit characters.
    If the cleaned number is 8 digits, prepends the country_code.
    If it already starts with the country code digits (e.g. 65...), ensures + prefix.

    Returns e.g. "+6591234567".
    """
    if not phone or not isinstance(phone, str):
        raise ValueError("Invalid Singapore phone number: must be 8 digits starting with 8 or 9")

    cleaned = _strip_non_digits(phone)
    cc_digits = _strip_non_digits(country_code) or "65"

    # If already has country code digits at front (with or without +), normalize
    if cleaned.startswith(cc_digits):
        local = cleaned[len(cc_digits):]
    elif cleaned.startswith("65") and cc_digits == "65":
        local = cleaned[2:]
    else:
        local = cleaned

    # If local part is 8 digits, prepend normalized country code
    if len(local) == _SG_PHONE_LENGTH:
        return f"+{cc_digits}{local}"

    # If input was already like +65XXXXXXXX or 65XXXXXXXX, reconstruct
    if cleaned.startswith(cc_digits) and len(cleaned) == len(cc_digits) + _SG_PHONE_LENGTH:
        return f"+{cleaned}"

    # Fallback: if after stripping we have exactly 8 digits, treat as local SG number
    if len(cleaned) == _SG_PHONE_LENGTH:
        return f"+{cc_digits}{cleaned}"

    # Otherwise, we cannot confidently normalize; return best effort +65 + cleaned if 8 digits
    if len(cleaned) == _SG_PHONE_LENGTH:
        return f"+{cc_digits}{cleaned}"

    # Invalid length cases will be caught by validate_sg_phone; return a clearly wrong form
    # so callers who validate will fail appropriately.
    return f"+{cc_digits}{cleaned}"


def validate_sg_phone(phone: str) -> bool:
    """Return True if phone is a valid Singapore number.

    Accepts local form (e.g. "91234567") or E.164 with +65 prefix (e.g. "+6591234567").
    After stripping non-digits and any leading "65" country code, must be exactly 8 digits
    starting with 8 or 9.
    """
    if not phone or not isinstance(phone, str):
        return False
    digits = _strip_non_digits(phone)
    # Strip leading SG country code if present (65 or +65 input becomes 65... after strip)
    if digits.startswith("65") and len(digits) == 10:
        digits = digits[2:]
    if len(digits) != _SG_PHONE_LENGTH:
        return False
    if not digits.startswith(_VALID_PREFIXES):
        return False
    return True


def validate_sg_phone_or_raise(phone: str) -> None:
    """Validate a Singapore phone; raise ValueError with the required message if invalid."""
    if not validate_sg_phone(phone):
        raise ValueError("Invalid Singapore phone number: must be 8 digits starting with 8 or 9")
