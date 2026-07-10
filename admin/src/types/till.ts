// Types for till (cash drawer) management — /till endpoints, manager view.

export interface TillSession {
  id: string;
  outlet_id: string;
  business_date: string;
  status: 'open' | 'closed';
  opening_float: string | number;
  expected_opening_float: string | number | null;
  opening_variance: string | number | null;
  opened_at: string;
  counted_cash: string | number | null;
  closed_at: string | null;
  expected_cash: string | number | null;
  variance: string | number | null;
  opened_by_staff_id?: string | null;
  closed_by_staff_id?: string | null;
}

export interface TillMovement {
  id: string;
  direction: 'in' | 'out' | 'nosale';
  amount: string | number;
  reason: string | null;
  created_at: string;
}

export interface TillCarryOver {
  expected_opening_float: string | number | null;
  previous_business_date: string | null;
  previous_counted_cash: string | number | null;
  previous_closed_at: string | null;
}
