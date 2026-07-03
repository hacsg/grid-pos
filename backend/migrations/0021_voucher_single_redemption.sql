-- A voucher may apply to exactly one order (not two).
CREATE UNIQUE INDEX uq_order_vouchers_single_redemption
    ON order_vouchers (voucher_id);
