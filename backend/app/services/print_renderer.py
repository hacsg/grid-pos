"""Text renderer for receipt and kitchen chit templates."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

RECEIPT_WIDTH = 32
SUPPORTED_PAPER_WIDTHS = {58: 32, 80: 48}
RECEIPT_BLOCK_TYPES = {"header", "orderMeta", "itemsTable", "totals", "payment", "footer", "text", "feedCut"}
KITCHEN_BLOCK_TYPES = {"kitchenHeader", "kitchenItems", "feedCut"}


def _receipt_default_blocks() -> list[dict[str, Any]]:
    return [
        {"type": "header", "visible": True, "fields": {"showBrandName": True, "showCompanyDetails": True, "showOutletName": True}},
        {"type": "orderMeta", "visible": True, "fields": {"showOrderNumber": True, "showDate": True}},
        {"type": "itemsTable", "visible": True, "fields": {"columns": ["qty", "name", "price"], "showModifiers": True}},
        {"type": "totals", "visible": True, "fields": {"showDiscounts": True, "showVouchers": True, "showGrandTotal": True}},
        {"type": "payment", "visible": True, "fields": {"showMethod": True, "showChange": True}},
        {"type": "footer", "visible": True, "fields": {"line1": "Thank you"}},
        {"type": "feedCut", "visible": True, "fields": {"lines": 0}},
    ]


def _kitchen_default_blocks() -> list[dict[str, Any]]:
    return [
        {"type": "kitchenHeader", "visible": True, "fields": {"title": "KITCHEN", "showOrderNumber": True, "showTime": True}},
        {"type": "kitchenItems", "visible": True, "fields": {"showModifiers": True}},
        {"type": "feedCut", "visible": True, "fields": {"lines": 0}},
    ]


def default_template_config(document_type: str) -> dict[str, Any]:
    """Return the hardcoded fallback config for a document type."""
    if document_type == "receipt":
        blocks = _receipt_default_blocks()
    elif document_type == "kitchen_chit":
        blocks = _kitchen_default_blocks()
    else:
        raise ValueError(f"Unsupported document type: {document_type}")
    return {
        "documentType": document_type,
        "pageSize": {"widthMM": 58, "charWidth": RECEIPT_WIDTH},
        "blocks": deepcopy(blocks),
    }


def sample_order_data(document_type: str = "receipt") -> dict[str, Any]:
    """Return a stable sample order for previews."""
    return {
        "documentType": document_type,
        "orderNumber": "0042",
        "createdAt": "2026-07-07T02:30:00.000Z",
        "usePrintTime": False,
        "items": [
            {"quantity": 2, "name": "Coconut Pandan Waffle", "modifiers": ["Extra crispy"], "unitPrice": 9.99, "notes": None},
            {"quantity": 1, "name": "Iced Latte", "modifiers": [], "unitPrice": 5.5, "notes": None},
        ],
        "totals": {"total": 25.48, "discount": 2.0, "voucherDiscount": 3.0},
        "discounts": [{"name": "Discount", "amountOff": 2.0}],
        "payment": {
            "method": "split",
            "cashAmount": 10.0,
            "cardAmount": 9.48,
            "voucherAmount": 3.0,
            "cdcAmount": 0,
            "changeDue": 1.5,
            "manualPayNow": False,
            "terminalPaymentMethod": "card",
        },
        "outlet": {"name": "Grid Test Outlet", "brandName": "Grid Waffles", "companyDetails": "Grid Pte Ltd\nUEN 202600001A"},
        "vouchers": [{"code": "ACRE-10", "type": "acre_group", "amount": 3.0}],
    }


def validate_template_config(config: dict[str, Any] | None, document_type: str | None = None) -> dict[str, Any]:
    """Validate flexible template JSON while rejecting unusable printer layouts."""
    if not isinstance(config, dict):
        raise ValueError("config must be an object")
    configured_type = config.get("documentType")
    effective_type = document_type or configured_type
    if effective_type not in ("receipt", "kitchen_chit"):
        raise ValueError("config.documentType must be receipt or kitchen_chit")
    if configured_type is not None and configured_type != effective_type:
        raise ValueError("config.documentType must match document_type")
    page_size = config.get("pageSize")
    if not isinstance(page_size, dict):
        raise ValueError("config.pageSize must be an object")
    width_mm = page_size.get("widthMM")
    char_width = page_size.get("charWidth")
    if width_mm not in SUPPORTED_PAPER_WIDTHS:
        raise ValueError("config.pageSize.widthMM must be 58 or 80")
    if not isinstance(char_width, int) or not 16 <= char_width <= 64:
        raise ValueError("config.pageSize.charWidth must be between 16 and 64")
    blocks = config.get("blocks")
    if not isinstance(blocks, list):
        raise ValueError("config.blocks must be a list")
    if not blocks:
        raise ValueError("config.blocks must contain at least one block")
    if len(blocks) > 30:
        raise ValueError("config.blocks cannot contain more than 30 blocks")
    allowed_types = RECEIPT_BLOCK_TYPES if effective_type == "receipt" else KITCHEN_BLOCK_TYPES
    for index, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise ValueError(f"config.blocks[{index}] must be an object")
        if "type" not in block or "visible" not in block:
            raise ValueError(f"config.blocks[{index}] must include type and visible")
        if block.get("type") not in allowed_types:
            raise ValueError(f"config.blocks[{index}].type is not valid for {effective_type}")
        if not isinstance(block.get("visible"), bool):
            raise ValueError(f"config.blocks[{index}].visible must be a boolean")
        if not isinstance(block.get("fields", {}), dict):
            raise ValueError(f"config.blocks[{index}].fields must be an object")
        fields = block.get("fields", {})
        if block.get("type") == "feedCut":
            lines = fields.get("lines", 0)
            if not isinstance(lines, int) or not 0 <= lines <= 10:
                raise ValueError(f"config.blocks[{index}].fields.lines must be between 0 and 10")
        if block.get("type") == "text" and len(str(fields.get("content") or "")) > 500:
            raise ValueError(f"config.blocks[{index}].fields.content cannot exceed 500 characters")
        if block.get("type") == "kitchenHeader" and len(str(fields.get("title") or "")) > 32:
            raise ValueError(f"config.blocks[{index}].fields.title cannot exceed 32 characters")
    return config


def _money(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _format_currency(value: Any) -> str:
    return f"${_money(value):,.2f}"


def _center(text: str, width: int) -> str:
    pad = max(0, (width - len(text)) // 2)
    return " " * pad + text


def _row(left: str, right: str = "", width: int = RECEIPT_WIDTH) -> str:
    if not right:
        return left
    space = width - len(right) - 1
    if len(left) > space:
        return f"{left}\n{right.rjust(width)}"
    return f"{left.ljust(space)} {right}"


def _parse_dt(value: Any) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else datetime.now()
    except ValueError:
        return datetime.now()


def _receipt_timestamp(order_data: dict[str, Any]) -> str:
    return _parse_dt(order_data.get("createdAt")).strftime("%-d/%-m/%Y, %-I:%M:%S %p")


def _receipt_time(order_data: dict[str, Any]) -> str:
    return _parse_dt(order_data.get("createdAt")).strftime("%H:%M")


def _payment_mode_label(mode: str) -> str:
    return "PayNow" if mode == "paynow" else mode[:1].upper() + mode[1:]


def _terminal_method_label(method: str) -> str:
    return "PayNow" if method == "paynow" else "Card"


def _payment_lines(order_data: dict[str, Any]) -> list[str]:
    payment = order_data.get("payment")
    if not isinstance(payment, dict):
        return []
    method = str(payment.get("method") or "")
    if method != "split":
        if method == "paynow" and payment.get("manualPayNow"):
            return ["Payment: PayNow (Manual)", f"Amount: {_format_currency(payment.get('cardAmount'))}"]
        return [f"Payment: {_payment_mode_label(method)}"] if method else []

    lines = ["Payment: Split"]
    if _money(payment.get("cashAmount")) > 0:
        lines.append(f"  Cash: {_format_currency(payment.get('cashAmount'))}")
    if _money(payment.get("cdcAmount")) > 0:
        lines.append(f"  CDC voucher: {_format_currency(payment.get('cdcAmount'))}")
    if _money(payment.get("cardAmount")) > 0:
        label = _terminal_method_label(str(payment.get("terminalPaymentMethod") or "card"))
        if payment.get("manualPayNow") and payment.get("terminalPaymentMethod") == "paynow":
            label = "PayNow (Manual)"
        lines.append(f"  {label}: {_format_currency(payment.get('cardAmount'))}")
    if _money(payment.get("voucherAmount")) > 0:
        lines.append(f"  Voucher: {_format_currency(payment.get('voucherAmount'))}")
    return lines


def _render_header(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    outlet = order_data.get("outlet") if isinstance(order_data.get("outlet"), dict) else {}
    brand = str(outlet.get("brandName") or outlet.get("name") or "").strip()
    company_details = str(outlet.get("companyDetails") or "")
    lines: list[str] = []
    if fields.get("showBrandName", True) and brand:
        lines.append(_center(brand.upper(), width))
    if fields.get("showCompanyDetails", True):
        lines.extend(_center(line.strip(), width) for line in company_details.splitlines() if line.strip())
    if fields.get("showOutletName", True) and outlet.get("name"):
        lines.append(_center(str(outlet["name"]), width))
    if lines:
        lines.append("-" * width)
    return lines


def _render_order_meta(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines: list[str] = []
    if fields.get("showOrderNumber", True):
        lines.append(_row(f"Order {order_data.get('orderNumber', '')}", width=width))
    if fields.get("showDate", True):
        lines.append(_row(_receipt_timestamp(order_data), width=width))
    if lines:
        lines.append("-" * width)
    return lines


def _render_items_table(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines: list[str] = []
    columns = fields.get("columns") if isinstance(fields.get("columns"), list) else ["qty", "name", "price"]
    for item in order_data.get("items", []):
        if not isinstance(item, dict):
            continue
        quantity = int(item.get("quantity") or 0)
        name = str(item.get("name") or "")
        unit_price = _money(item.get("unitPrice"))
        left = f"{quantity} x {name}" if "qty" in columns else name
        right = _format_currency(unit_price * quantity) if "price" in columns else ""
        lines.append(_row(left, right, width))
        if fields.get("showModifiers", True):
            for modifier in item.get("modifiers", []) or []:
                lines.append(f"  {modifier}")
        if fields.get("showNotes") and item.get("notes"):
            lines.append(f"  Note: {item['notes']}")
    if lines:
        lines.append("-" * width)
    return lines


def _render_totals(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    totals = order_data.get("totals") if isinstance(order_data.get("totals"), dict) else {}
    lines: list[str] = []
    if fields.get("showDiscounts", True):
        discounts = order_data.get("discounts")
        if isinstance(discounts, list) and discounts:
            for discount in discounts:
                if isinstance(discount, dict) and _money(discount.get("amountOff")) > 0:
                    lines.append(_row(str(discount.get("name") or "Discount"), f"-{_format_currency(discount.get('amountOff'))}", width))
        elif _money(totals.get("discount")) > 0:
            lines.append(_row("Discount", f"-{_format_currency(totals.get('discount'))}", width))
    if fields.get("showVouchers", True) and _money(totals.get("voucherDiscount")) > 0:
        lines.append(_row("Vouchers", f"-{_format_currency(totals.get('voucherDiscount'))}", width))
    if fields.get("showGrandTotal", True):
        lines.append(_row("TOTAL", _format_currency(totals.get("total")), width))
    return lines


def _render_payment(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines = _payment_lines(order_data) if fields.get("showMethod", True) else []
    payment = order_data.get("payment") if isinstance(order_data.get("payment"), dict) else {}
    if fields.get("showChange", True) and _money(payment.get("changeDue")) > 0:
        lines.append(_row("Change", _format_currency(payment.get("changeDue")), width))
    return lines


def _render_loyalty(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines: list[str] = []
    loyalty = order_data.get("loyalty") if isinstance(order_data.get("loyalty"), dict) else {}
    if fields.get("showEarnedPoints") and loyalty.get("earnedPoints") is not None:
        lines.append(_row(str(fields.get("earnedLabel") or "Points earned"), str(loyalty.get("earnedPoints")), width))
    if fields.get("showRedeemedPoints") and loyalty.get("redeemedPoints") is not None:
        lines.append(_row("Points redeemed", str(loyalty.get("redeemedPoints")), width))
    if fields.get("referralCode"):
        lines.append(_row("Referral", str(fields["referralCode"]), width))
    return lines


def _render_footer(_order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines = []
    if fields.get("line1"):
        lines.append(_center(str(fields["line1"]), width))
    if fields.get("line2"):
        lines.append(_center(str(fields["line2"]), width))
    return lines


def _render_text(_order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    value = str(fields.get("content") or "")
    if fields.get("uppercase"):
        value = value.upper()
    align = fields.get("align")
    return [_center(line, width) if align == "center" else line for line in value.splitlines() if line]


def _render_feed_cut(fields: dict[str, Any]) -> list[str]:
    return [""] * max(0, int(fields.get("lines") or 0))


def _render_kitchen_header(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines = []
    if fields.get("showOrderNumber", True):
        lines.append(f"#{order_data.get('orderNumber', '')}")
    lines.append(str(fields.get("title") or "KITCHEN"))
    if fields.get("showTime", True):
        lines.append(_receipt_time(order_data))
    lines.append("-" * width)
    return lines


def _render_kitchen_items(order_data: dict[str, Any], fields: dict[str, Any], width: int) -> list[str]:
    lines = []
    for item in order_data.get("items", []):
        if not isinstance(item, dict):
            continue
        lines.append(f"{int(item.get('quantity') or 0)} x {str(item.get('name') or '').upper()}")
        if fields.get("showModifiers", True):
            for modifier in item.get("modifiers", []) or []:
                lines.append(f"   - {modifier}")
        if fields.get("showNotes") and item.get("notes"):
            lines.append(f"   * {item['notes']}")
        lines.append("")
    if lines:
        lines.append("-" * width)
    return lines


def render_document(template_config: dict[str, Any], order_data: dict[str, Any]) -> str:
    """Render a receipt or kitchen chit into printer-friendly text."""
    config = validate_template_config(template_config)
    width = int(((config.get("pageSize") or {}).get("charWidth")) or RECEIPT_WIDTH)
    lines: list[str] = []
    show_voucher_details = any(
        block.get("visible", True)
        and block.get("type") == "totals"
        and (block.get("fields") or {}).get("showVouchers", True)
        for block in config["blocks"]
    )
    renderers = {
        "header": lambda fields: _render_header(order_data, fields, width),
        "orderMeta": lambda fields: _render_order_meta(order_data, fields, width),
        "itemsTable": lambda fields: _render_items_table(order_data, fields, width),
        "totals": lambda fields: _render_totals(order_data, fields, width),
        "payment": lambda fields: _render_payment(order_data, fields, width),
        "loyalty": lambda fields: _render_loyalty(order_data, fields, width),
        "footer": lambda fields: _render_footer(order_data, fields, width),
        "text": lambda fields: _render_text(order_data, fields, width),
        "feedCut": lambda fields: _render_feed_cut(fields),
        "kitchenHeader": lambda fields: _render_kitchen_header(order_data, fields, width),
        "kitchenItems": lambda fields: _render_kitchen_items(order_data, fields, width),
    }

    for block in config["blocks"]:
        if not block.get("visible", True):
            continue
        renderer = renderers.get(str(block.get("type") or ""))
        if renderer is None:
            continue
        fields = block.get("fields") if isinstance(block.get("fields"), dict) else {}
        lines.extend(renderer(fields))

    text = "\n".join(lines).rstrip()
    document_type = str(config.get("documentType") or order_data.get("documentType") or "receipt")
    if document_type == "receipt":
        vouchers = order_data.get("vouchers")
        totals = order_data.get("totals") if isinstance(order_data.get("totals"), dict) else {}
        if show_voucher_details and isinstance(vouchers, list) and vouchers:
            voucher_lines = [
                "",
                _row(
                    "Vouchers redeemed",
                    _format_currency(totals.get("voucherDiscount") or sum(_money(v.get("amount")) for v in vouchers if isinstance(v, dict))),
                    width,
                ),
            ]
            for voucher in vouchers:
                if not isinstance(voucher, dict):
                    continue
                label = "CDC" if voucher.get("type") == "cdc" else "Acre Group"
                voucher_lines.append(_row(f"  {label} {voucher.get('code', '')}", f"-{_format_currency(voucher.get('amount'))}", width))
            text = f"{text}\n" + "\n".join(voucher_lines)
    return text.rstrip()
