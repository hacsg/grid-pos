"""Import all SQLAlchemy models so Alembic can discover metadata."""

from app.models.category import Category
from app.models.modifier import ModifierGroup, ModifierOption, ProductModifierGroup
from app.models.order import Order, OrderStatus
from app.models.order_item import OrderItem
from app.models.outlet import Outlet
from app.models.product import Product
from app.models.shift import Shift
from app.models.staff import Staff, StaffRole
from app.models.discount import Discount
from app.models.voucher import OrderVoucher, Voucher, VoucherType

__all__ = [
    "Category",
    "Discount",
    "ModifierGroup",
    "ModifierOption",
    "Order",
    "OrderItem",
    "OrderStatus",
    "OrderVoucher",
    "Outlet",
    "Product",
    "ProductModifierGroup",
    "Shift",
    "Staff",
    "StaffRole",
    "Voucher",
    "VoucherType",
]
