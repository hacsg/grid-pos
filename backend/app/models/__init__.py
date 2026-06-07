"""Import all SQLAlchemy models so Alembic can discover metadata."""

from app.models.category import Category
from app.models.modifier import Modifier, ModifierGroup
from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.staff import Staff, StaffRole

__all__ = [
    "Category",
    "Modifier",
    "ModifierGroup",
    "Order",
    "OrderItem",
    "OrderStatus",
    "Outlet",
    "Product",
    "Staff",
    "StaffRole",
]
