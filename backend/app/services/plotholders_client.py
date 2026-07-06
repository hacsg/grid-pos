"""Async client for the Plotholders loyalty API."""

from decimal import Decimal
from typing import Any
from uuid import UUID

import httpx

from app.config import settings
from app.utils.phone import normalize_sg_phone


class PlotholdersAPIError(Exception):
    """Raised when the Plotholders API returns an error or invalid payload."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        response_body: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class PlotholdersClient:
    """Small async HTTP wrapper around Plotholders customer and redemption APIs."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout: float = 5.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or settings.plotholders_api_url).rstrip("/")
        self.timeout = timeout
        self.transport = transport

    async def lookup_by_phone(self, phone: str) -> dict[str, Any] | None:
        """Return the first Plotholders customer matching a phone number.

        Phone is normalized to E.164 SG format (+65XXXXXXXX) before sending.
        """
        normalized = normalize_sg_phone(phone)
        data = await self._request(
            "GET",
            "/api/customers",
            params={"phone": normalized},
            allow_not_found=True,
        )
        return self._first_customer(data)

    async def lookup_by_referral_code(self, code: str) -> dict[str, Any] | None:
        """Return a customer by referral code, falling back if the query is unsupported."""
        normalized_code = code.strip()
        try:
            data = await self._request(
                "GET",
                "/api/customers",
                params={"referral_code": normalized_code},
                allow_not_found=True,
            )
            customer = self._first_customer(data, referral_code=normalized_code)
            if customer is not None:
                return customer
        except PlotholdersAPIError as exc:
            if exc.status_code not in {400, 404, 422}:
                raise

        fallback_data = await self._request(
            "GET",
            "/api/customers",
            params={"phone": normalized_code},
            allow_not_found=True,
        )
        return self._first_customer(fallback_data, referral_code=normalized_code)

    async def create_customer(
        self,
        *,
        phone: str,
        email: str | None = None,
        name: str | None = None,
        birthday: str | None = None,
        referred_by_code: str | None = None,
        campaign_code: str | None = None,
    ) -> dict[str, Any]:
        """Create a Plotholders customer.

        Phone is normalized to E.164 SG format (+65XXXXXXXX) before sending.
        """
        normalized = normalize_sg_phone(phone)
        payload = {
            "phone": normalized,
            "email": email,
            "name": name,
            "birthday": birthday,
            "referred_by_code": referred_by_code,
            "campaign_code": campaign_code,
        }
        return await self._request(
            "POST",
            "/api/customers",
            json={key: value for key, value in payload.items() if value is not None},
        )

    async def record_purchase(
        self,
        customer_id: str,
        order_total: float | None = None,
        outlet: str = "",
        *,
        order_id: UUID | str | None = None,
        amount: Decimal | None = None,
    ) -> dict[str, Any]:
        """Record a purchase moment via Plotholders API.

        Supports both the simple (customer_id, order_total, outlet) call and the
        legacy detailed call with order_id/amount (uses /moments for full data).
        """
        # A moment = one visit. We always award exactly 1 per order and rely on
        # the moments unique(channel, source_id) constraint (source_id = order id)
        # for idempotency — a retried sync never double-counts a trip. The dollar
        # total rides along as order_total for analytics only; it is not the
        # moment amount and does not affect tiering.
        dollar_total = float(amount) if amount is not None else float(order_total or 0)
        # source_id=order id gives one-moment-per-order idempotency. Without an
        # order id we send null (Postgres treats NULLs as distinct, so the
        # unique(channel, source_id) constraint won't reject a second visit).
        return await self._request(
            "POST",
            "/api/moments",
            json={
                "customer_id": customer_id,
                "channel": "grid",
                "source_id": str(order_id) if order_id is not None else None,
                "amount": 1,
                "order_total": dollar_total,
                "reason": "visit",
                "outlet": outlet,
                "brand": "hundred-acre",
            },
        )

    async def sync_order(self, order_data: dict) -> dict[str, Any]:
        """Sync completed order to Plotholders."""
        return await self._request("POST", "/api/sync/grid-order", json=order_data)

    async def redeem_voucher(self, voucher_id: str) -> dict[str, Any]:
        """Redeem a Plotholders voucher by ID."""
        return await self._request("POST", f"/api/vouchers/{voucher_id}/redeem")

    async def redeem_voucher_by_code(
        self,
        code: str,
        staff_id: str,
        outlet: str,
    ) -> dict[str, Any]:
        """Redeem a Plotholders voucher by code, staff ID, and outlet."""
        return await self._request(
            "POST",
            "/api/vouchers/redeem",
            json={"code": code, "staff_id": staff_id, "outlet": outlet},
        )

    async def get_voucher(self, voucher_ref: str) -> dict[str, Any] | None:
        """Return a Plotholders voucher by id or code.

        Tries direct path first, then falls back to query param lookup.
        """
        ref = voucher_ref.strip()
        # Try treating as path id/code
        data = await self._request(
            "GET",
            f"/api/vouchers/{ref}",
            allow_not_found=True,
        )
        if data:
            return data if isinstance(data, dict) else None

        # Fallback: list query (if supported by upstream)
        try:
            list_data = await self._request(
                "GET",
                "/api/vouchers",
                params={"code": ref},
                allow_not_found=True,
            )
        except PlotholdersAPIError:
            list_data = None

        if list_data is None:
            return None

        vouchers: list[dict[str, Any]] = []
        if isinstance(list_data, list):
            vouchers = [v for v in list_data if isinstance(v, dict)]
        elif isinstance(list_data, dict):
            for key in ("vouchers", "data", "results", "items"):
                val = list_data.get(key)
                if isinstance(val, list):
                    vouchers = [v for v in val if isinstance(v, dict)]
                    break
            if not vouchers and "id" in list_data:
                vouchers = [list_data]

        for v in vouchers:
            code_val = v.get("code") or v.get("id") or v.get("voucher_code")
            if isinstance(code_val, str) and code_val.lower() == ref.lower():
                return v
            if v.get("id") == ref:
                return v
        return vouchers[0] if vouchers else None

    async def redeem_reward(self, reward_id: str) -> dict[str, Any]:
        """Redeem a Plotholders reward."""
        return await self._request("POST", f"/api/rewards/{reward_id}/redeem")

    async def get_customer(self, customer_id: str) -> dict[str, Any] | None:
        """Return a Plotholders customer (with tier + history) by id."""
        data = await self._request(
            "GET",
            f"/api/customers/{customer_id.strip()}",
            allow_not_found=True,
        )
        return data if isinstance(data, dict) else None

    async def list_customer_vouchers(
        self, customer_id: str, status: str = "active"
    ) -> list[dict[str, Any]]:
        """Return a customer's vouchers (default: active/redeemable) by id."""
        data = await self._request(
            "GET",
            f"/api/vouchers/customer/{customer_id.strip()}",
            params={"status": status} if status else None,
            allow_not_found=True,
        )
        if isinstance(data, dict):
            for key in ("data", "vouchers", "results", "items"):
                val = data.get(key)
                if isinstance(val, list):
                    return [v for v in val if isinstance(v, dict)]
            return []
        if isinstance(data, list):
            return [v for v in data if isinstance(v, dict)]
        return []

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        allow_not_found: bool = False,
    ) -> Any:
        headers: dict[str, str] = {}
        internal_key = settings.plotholders_internal_key
        if internal_key:
            # Server-to-server auth: Plotholders' requireServiceAuth accepts this
            # shared key on customer/voucher/moment endpoints (which are no longer
            # public). Must match INTERNAL_API_KEY on the Plotholders service.
            headers["X-Internal-Key"] = internal_key

        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            transport=self.transport,
            headers=headers,
        ) as client:
            try:
                response = await client.request(method, path, params=params, json=json)
            except httpx.HTTPError as exc:
                raise PlotholdersAPIError("Unable to reach Plotholders API") from exc

        if allow_not_found and response.status_code == 404:
            return None

        if response.is_error:
            raise PlotholdersAPIError(
                f"Plotholders API returned HTTP {response.status_code}",
                status_code=response.status_code,
                response_body=self._safe_json(response),
            )

        if response.status_code == 204 or not response.content:
            return {}

        try:
            return response.json()
        except ValueError as exc:
            raise PlotholdersAPIError(
                "Plotholders API returned invalid JSON",
                status_code=response.status_code,
            ) from exc

    def _safe_json(self, response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return response.text

    def _first_customer(
        self,
        data: Any,
        *,
        referral_code: str | None = None,
    ) -> dict[str, Any] | None:
        customers = self._customer_list(data)
        if referral_code is not None:
            referral_code_lower = referral_code.lower()
            for customer in customers:
                value = customer.get("referral_code")
                if isinstance(value, str) and value.lower() == referral_code_lower:
                    return customer
        return customers[0] if customers else None

    def _customer_list(self, data: Any) -> list[dict[str, Any]]:
        if data is None:
            return []
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if not isinstance(data, dict):
            return []

        for key in ("customers", "data", "results", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                return [value]

        customer = data.get("customer")
        if isinstance(customer, dict):
            return [customer]

        if "id" in data:
            return [data]
        return []
