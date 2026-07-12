import type { LoyaltyMember, LoyaltyReward, Product, SelectedModifier, Staff, Outlet, VoucherValidateResponse } from '@/api/client';

export interface CartModifier extends SelectedModifier {
  id: string;
}

export interface CartItem {
  lineId: string;
  product: Product;
  quantity: number;
  modifiers: CartModifier[];
  // Open-price / ad-hoc upcharge line: overrides price and display name.
  customPrice?: number;
  customLabel?: string;
}

export interface StaffSession {
  token: string;
  staff: Staff;
  outlet: Outlet;
  expiresAt: number;
}

export interface Discount {
  id?: string; // from DB if admin-managed
  label: string;
  amount: number;
  kind: 'fixed' | 'percent';
}

export interface LoyaltySelection {
  customer: LoyaltyMember;
  reward: LoyaltyReward | null;
}

export interface AppliedVoucher {
  code: string;
  type: 'cdc' | 'acre_group';
  amount: number;
  // local validated id if available
  id?: string;
}

export interface ParkedCart {
  id: string;
  parkedAt: string;
  items: CartItem[];
  discount: Discount | null;
  loyalty: LoyaltySelection | null;
  vouchers: AppliedVoucher[];
}

export interface Totals {
  subtotal: number;
  tax: number;
  /** Manual whole-cart discount (excludes lines claimed by a targeted rule). */
  discount: number;
  /** Sum of auto-applied product-targeted rule discounts. */
  targetedDiscount: number;
  loyaltyDiscount: number;
  voucherDiscount: number;
  total: number;
}
