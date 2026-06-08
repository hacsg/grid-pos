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
        }
        return await self._request(
            "POST",
            "/api/customers",
            json={key: value for key, value in payload.items() if value is not None},
        )

    async def record_purchase(
        self,
        *,
        customer_id: str,
        order_id: UUID | str,
        amount: Decimal,
        outlet: str,
    ) -> dict[str, Any]:
        """Record a Grid POS purchase as a Plotholders moment."""
        amount_value = float(amount)
        return await self._request(
            "POST",
            "/api/moments",
            json={
                "customer_id": customer_id,
                "channel": "grid",
                "source_id": str(order_id),
                "amount": amount_value,
                "order_total": amount_value,
                "outlet": outlet,
                "brand": "hundred-acre",
            },
        )

    async def redeem_voucher(self, voucher_id: str) -> dict[str, Any]:
        """Redeem a Plotholders voucher."""
        return await self._request("POST", f"/api/vouchers/{voucher_id}/redeem")

    async def redeem_reward(self, reward_id: str) -> dict[str, Any]:
        """Redeem a Plotholders reward."""
        return await self._request("POST", f"/api/rewards/{reward_id}/redeem")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        allow_not_found: bool = False,
    ) -> Any:
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout,
            transport=self.transport,
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
