import { request } from './client';

export interface PaymentIntent {
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'terminal_failed';
  out_trade_no: string;
  kpay_response?: Record<string, unknown>;
  error_message?: string;
}

export interface PaymentQueryResult extends PaymentIntent {
  terminal_status: 'success' | 'failed' | 'in-flight';
}

export async function startCardPayment(
  orderId: string,
  amount: number,
  paymentType = 1,
  options?: { idempotencyKey?: string },
): Promise<PaymentIntent> {
  const headers: Record<string, string> = {};
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  return request<PaymentIntent>('/api/kpay/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({ order_id: orderId, amount, payment_type: paymentType }),
  });
}

export async function queryPaymentIntent(intentId: string): Promise<PaymentQueryResult> {
  return request<PaymentQueryResult>(`/api/kpay/${intentId}/query`, {
    method: 'POST',
  });
}

export async function getPaymentStatus(intentId: string): Promise<PaymentIntent> {
  return request<PaymentIntent>(`/api/kpay/status/${intentId}`);
}

export async function getTerminalConnection(): Promise<{ connected: boolean }> {
  return request<{ connected: boolean }>('/api/kpay/connection');
}

export interface KPayReversalResult {
  result: 'ok' | 'failed';
  out_trade_no: string;
  message?: string | null;
}

export async function voidCardPayment(orderId: string): Promise<KPayReversalResult> {
  return request<KPayReversalResult>('/api/kpay/void', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId }),
  });
}

export async function refundCardPayment(orderId: string, amount?: number): Promise<KPayReversalResult> {
  return request<KPayReversalResult>('/api/kpay/refund', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, amount }),
  });
}
