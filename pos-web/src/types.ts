import type { LoyaltyMember, LoyaltyReward, Product, SelectedModifier, Staff, Outlet, VoucherValidateResponse } from '@/api/client';

export interface CartModifier extends SelectedModifier {
  id: string;
}

export interface CartItem {
  lineId: string;
  product: Product;
  quantity: number;
  modifiers: CartModifier[];
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
  discount: number;
  loyaltyDiscount: number;
  voucherDiscount: number;
  total: number;
}
