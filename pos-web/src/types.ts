import type { LoyaltyMember, LoyaltyReward, Product, SelectedModifier, Staff, Outlet } from '@/api/client';

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
  label: string;
  amount: number;
  kind: 'fixed' | 'percent';
}

export interface LoyaltySelection {
  customer: LoyaltyMember;
  reward: LoyaltyReward | null;
}

export interface Totals {
  subtotal: number;
  tax: number;
  discount: number;
  loyaltyDiscount: number;
  total: number;
}
