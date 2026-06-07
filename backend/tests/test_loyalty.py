"""Tests for loyalty API endpoints — lookup, earn, redeem, signup."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest_asyncio
from httpx import AsyncClient

from app.models.loyalty import LoyaltyMember
from app.services.loyalty import POINTS_PER_DOLLAR


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def bronze_member(db_session) -> LoyaltyMember:
    """Create a bronze-tier loyalty member with 100 points."""
    member = LoyaltyMember(
        name="Jane Doe",
        phone="91234567",
        points=100,
        tier="bronze",
        total_spent=Decimal("10.00"),
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


@pytest_asyncio.fixture
async def silver_member(db_session) -> LoyaltyMember:
    """Create a silver-tier loyalty member with 450 points."""
    member = LoyaltyMember(
        name="John Smith",
        phone="87654321",
        points=450,
        tier="silver",
        total_spent=Decimal("80.00"),
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


@pytest_asyncio.fixture
async def gold_member(db_session) -> LoyaltyMember:
    """Create a gold-tier loyalty member with 2500 points."""
    member = LoyaltyMember(
        name="Alice Wang",
        phone="88888888",
        points=2500,
        tier="gold",
        total_spent=Decimal("400.00"),
    )
    db_session.add(member)
    await db_session.commit()
    await db_session.refresh(member)
    return member


# ---------------------------------------------------------------------------
# Lookup tests
# ---------------------------------------------------------------------------


class TestLookupMember:
    """POST /api/loyalty/lookup"""

    async def test_lookup_existing_member(
        self, client: AsyncClient, silver_member: LoyaltyMember
    ) -> None:
        """Lookup an existing member by phone returns their profile."""
        resp = await client.post(
            "/api/loyalty/lookup",
            json={"phone": silver_member.phone},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["member_id"] == str(silver_member.id)
        assert data["name"] == silver_member.name
        assert data["phone"] == silver_member.phone
        assert data["points"] == silver_member.points
        assert str(data["points_value"]) == "4.50"
        assert data["tier"] == "silver"

    async def test_lookup_bronze_member(
        self, client: AsyncClient, bronze_member: LoyaltyMember
    ) -> None:
        """Lookup a bronze member shows correct tier and value."""
        resp = await client.post(
            "/api/loyalty/lookup",
            json={"phone": bronze_member.phone},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["tier"] == "bronze"
        assert str(data["points_value"]) == "1.00"

    async def test_lookup_gold_member(
        self, client: AsyncClient, gold_member: LoyaltyMember
    ) -> None:
        """Lookup a gold member shows correct tier and value."""
        resp = await client.post(
            "/api/loyalty/lookup",
            json={"phone": gold_member.phone},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["tier"] == "gold"
        assert str(data["points_value"]) == "25.00"

    async def test_lookup_nonexistent_member_returns_404(
        self, client: AsyncClient
    ) -> None:
        """Lookup a phone not in the system returns 404 with signup flag."""
        resp = await client.post(
            "/api/loyalty/lookup",
            json={"phone": "99999999"},
        )
        assert resp.status_code == 404
        detail = resp.json()["detail"]
        if isinstance(detail, dict):
            assert detail["detail"] == "Member not found"
            assert detail["signup_available"] is True
        else:
            assert "Member not found" in str(detail)


# ---------------------------------------------------------------------------
# Earn tests
# ---------------------------------------------------------------------------


class TestEarnPoints:
    """POST /api/loyalty/earn"""

    async def test_earn_points_after_order(
        self, client: AsyncClient, silver_member: LoyaltyMember, outlet, cashier_staff, product
    ) -> None:
        """Earning points increases member balance and updates tier if needed."""
        order_resp = await client.post(
            "/api/orders",
            json={
                "outlet_id": str(outlet.id),
                "staff_id": str(cashier_staff.id),
                "items": [{"product_id": str(product.id), "quantity": 1}],
            },
        )
        assert order_resp.status_code == 201
        order_id = order_resp.json()["id"]

        resp = await client.post(
            "/api/loyalty/earn",
            json={
                "member_id": str(silver_member.id),
                "order_id": order_id,
                "amount_spent": "15.30",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        expected_points = int(Decimal("15.30") * POINTS_PER_DOLLAR)
        assert data["points_earned"] == expected_points
        assert data["new_balance"] == silver_member.points + expected_points
        assert data["tier"] == "silver"

        # Verify order was updated
        order_get = await client.get(f"/api/orders/{order_id}")
        assert order_get.status_code == 200
        assert order_get.json()["loyalty_points_earned"] == expected_points

    async def test_earn_promotes_tier(
        self, client: AsyncClient, bronze_member: LoyaltyMember, outlet, cashier_staff, product
    ) -> None:
        """Earning enough points can promote a member to a higher tier."""
        order_resp = await client.post(
            "/api/orders",
            json={
                "outlet_id": str(outlet.id),
                "staff_id": str(cashier_staff.id),
                "items": [{"product_id": str(product.id), "quantity": 1}],
            },
        )
        order_id = order_resp.json()["id"]
        resp = await client.post(
            "/api/loyalty/earn",
            json={
                "member_id": str(bronze_member.id),
                "order_id": order_id,
                "amount_spent": "40.00",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["points_earned"] == 400
        assert data["new_balance"] == 500
        assert data["tier"] == "silver"

    async def test_earn_nonexistent_member_returns_404(
        self, client: AsyncClient
    ) -> None:
        """Earning points for a non-existent member returns 404."""
        resp = await client.post(
            "/api/loyalty/earn",
            json={
                "member_id": str(uuid4()),
                "order_id": str(uuid4()),
                "amount_spent": "10.00",
            },
        )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Redeem tests
# ---------------------------------------------------------------------------


class TestRedeemPoints:
    """POST /api/loyalty/redeem"""

    async def test_redeem_points_reduces_balance(
        self, client: AsyncClient, silver_member: LoyaltyMember
    ) -> None:
        """Redeeming valid points reduces member balance and returns discount."""
        resp = await client.post(
            "/api/loyalty/redeem",
            json={
                "member_id": str(silver_member.id),
                "order_id": str(uuid4()),
                "points_to_redeem": 100,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["points_redeemed"] == 100
        assert str(data["discount_amount"]) == "1.00"
        assert data["remaining_balance"] == 350
        assert data["new_points"] == 350

    async def test_redeem_full_balance(
        self, client: AsyncClient, bronze_member: LoyaltyMember
    ) -> None:
        """Redeeming all available points (100) works."""
        resp = await client.post(
            "/api/loyalty/redeem",
            json={
                "member_id": str(bronze_member.id),
                "order_id": str(uuid4()),
                "points_to_redeem": 100,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["points_redeemed"] == 100
        assert data["remaining_balance"] == 0
        assert data["new_points"] == 0

    async def test_redeem_more_than_balance_returns_400(
        self, client: AsyncClient, bronze_member: LoyaltyMember
    ) -> None:
        """Redeeming more points than available returns 400."""
        resp = await client.post(
            "/api/loyalty/redeem",
            json={
                "member_id": str(bronze_member.id),
                "order_id": str(uuid4()),
                "points_to_redeem": 200,
            },
        )
        assert resp.status_code == 400
        assert "insufficient" in resp.json()["detail"].lower()

    async def test_redeem_below_minimum_returns_400(
        self, client: AsyncClient, silver_member: LoyaltyMember
    ) -> None:
        """Redeeming fewer than 100 points returns 400."""
        resp = await client.post(
            "/api/loyalty/redeem",
            json={
                "member_id": str(silver_member.id),
                "order_id": str(uuid4()),
                "points_to_redeem": 50,
            },
        )
        assert resp.status_code == 400
        assert "minimum" in resp.json()["detail"].lower()

    async def test_redeem_nonexistent_member_returns_404(
        self, client: AsyncClient
    ) -> None:
        """Redeeming for a non-existent member returns 404."""
        resp = await client.post(
            "/api/loyalty/redeem",
            json={
                "member_id": str(uuid4()),
                "order_id": str(uuid4()),
                "points_to_redeem": 100,
            },
        )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Signup tests
# ---------------------------------------------------------------------------


class TestSignup:
    """POST /api/loyalty/signup"""

    async def test_signup_new_member(
        self, client: AsyncClient
    ) -> None:
        """Creating a new member returns their profile with zero points and bronze tier."""
        resp = await client.post(
            "/api/loyalty/signup",
            json={"name": "John", "phone": "98765432"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "John"
        assert data["points"] == 0
        assert data["tier"] == "bronze"
        UUID(data["member_id"])

    async def test_signup_duplicate_phone_returns_409(
        self, client: AsyncClient, silver_member: LoyaltyMember
    ) -> None:
        """Creating a member with an existing phone returns 409."""
        resp = await client.post(
            "/api/loyalty/signup",
            json={"name": "Duplicate", "phone": silver_member.phone},
        )
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Full flow: lookup → redeem → order → earn → verify
# ---------------------------------------------------------------------------


class TestFullFlow:
    """End-to-end loyalty flow."""

    async def test_full_loyalty_flow(
        self,
        client: AsyncClient,
        db_session,
        outlet,
        cashier_staff,
        product,
        silver_member: LoyaltyMember,
    ) -> None:
        """Complete flow: lookup member → redeem points → create order → earn points → verify."""
        # 1. Lookup member
        lookup_resp = await client.post(
            "/api/loyalty/lookup", json={"phone": silver_member.phone}
        )
        assert lookup_resp.status_code == 200
        member_data = lookup_resp.json()
        assert member_data["tier"] == "silver"
        assert member_data["points"] == 450

        # 2. Redeem 100 points for S$1.00 discount
        redeem_resp = await client.post(
            "/api/loyalty/redeem",
            json={
                "member_id": str(silver_member.id),
                "order_id": str(uuid4()),
                "points_to_redeem": 100,
            },
        )
        assert redeem_resp.status_code == 200
        assert str(redeem_resp.json()["discount_amount"]) == "1.00"

        # 3. Create order with loyalty discount
        discount_amount = redeem_resp.json()["discount_amount"]
        order_resp = await client.post(
            "/api/orders",
            json={
                "outlet_id": str(outlet.id),
                "staff_id": str(cashier_staff.id),
                "items": [{"product_id": str(product.id), "quantity": 2}],
                "loyalty_member_id": str(silver_member.id),
                "loyalty_points_redeemed": 100,
                "loyalty_discount": discount_amount,
            },
        )
        assert order_resp.status_code == 201
        order_data = order_resp.json()

        # subtotal = 2 * 9.99 = 19.98
        assert str(order_data["subtotal"]) == "19.98"
        # total = 19.98 - 1.00 = 18.98
        assert str(order_data["total"]) == "18.98"
        assert order_data["loyalty_member_id"] == str(silver_member.id)
        assert order_data["loyalty_points_redeemed"] == 100

        # 4. Earn points on the paid amount
        earn_resp = await client.post(
            "/api/loyalty/earn",
            json={
                "member_id": str(silver_member.id),
                "order_id": order_data["id"],
                "amount_spent": "18.98",
            },
        )
        assert earn_resp.status_code == 200
        earn_data = earn_resp.json()
        assert earn_data["points_earned"] == 189
        assert earn_data["new_balance"] == 539

        # 5. Verify order now shows points earned
        order_get = await client.get(f"/api/orders/{order_data['id']}")
        assert order_get.status_code == 200
        assert order_get.json()["loyalty_points_earned"] == 189

        # 6. Lookup again to verify updated balance
        lookup2_resp = await client.post(
            "/api/loyalty/lookup", json={"phone": silver_member.phone}
        )
        assert lookup2_resp.status_code == 200
        assert lookup2_resp.json()["points"] == 539