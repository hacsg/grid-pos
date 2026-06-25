"""Unit tests for KPay payment helpers (money + result interpretation)."""

from decimal import Decimal

from app.config import settings
from app.services import payment_intents as pi


class TestToCents:
    def test_exact(self) -> None:
        assert pi._to_cents(Decimal("10.00")) == 1000

    def test_no_float_rounding_error(self) -> None:
        # 19.99 * 100 in float is 1998.9999...; Decimal path must give 1999.
        assert pi._to_cents(Decimal("19.99")) == 1999

    def test_half_up(self) -> None:
        assert pi._to_cents(Decimal("0.005")) == 1


class TestIsApproved:
    def test_success_code_is_two_per_spec(self) -> None:
        # KPOS LAN spec payResult: 1=pending, 2=successful.
        assert settings.kpay_payresult_success == 2
        assert pi._is_approved({"pay_result": 2}) is True
        assert pi._is_approved({"pay_result": 1}) is False  # pending, not success

    def test_matches_configured_success_code(self) -> None:
        assert pi._is_approved({"pay_result": settings.kpay_payresult_success}) is True

    def test_string_success_code(self) -> None:
        assert pi._is_approved({"pay_result": str(settings.kpay_payresult_success)}) is True

    def test_non_success_code(self) -> None:
        assert pi._is_approved({"pay_result": settings.kpay_payresult_success + 99}) is False

    def test_missing_or_garbage(self) -> None:
        assert pi._is_approved({}) is False
        assert pi._is_approved({"pay_result": "abc"}) is False


class TestNormalizeSaleResult:
    def test_extracts_persisted_fields(self) -> None:
        event = {
            "type": "sale_result",
            "request_id": "r1",
            "out_trade_no": "KPAY-1",
            "transaction_no": "TXN-1",
            "ref_no": "REF-1",
            "pay_method": 3,
            "pay_result": 1,
            "reason": "Insufficient funds",
            "extra": "ignored",
        }
        result = pi._normalize_sale_result(event)
        assert result == {
            "out_trade_no": "KPAY-1",
            "transaction_no": "TXN-1",
            "ref_no": "REF-1",
            "pay_method": 3,
            "pay_result": 1,
            "reason": "Insufficient funds",
        }


class TestNewOutTradeNo:
    def test_prefix_and_uniqueness(self) -> None:
        a = pi.new_out_trade_no("VOID")
        b = pi.new_out_trade_no("VOID")
        assert a.startswith("VOID-")
        assert a != b
