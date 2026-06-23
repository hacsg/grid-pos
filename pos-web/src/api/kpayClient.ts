import { request } from './client';

export interface PaymentIntent {
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'timeout' | 'cancelled';
  out_trade_no: string;
  kpay_response?: Record<string, unknown>;
  error_message?: string;
}

export async function startCardPayment(orderId: string, amount: number): Promise<PaymentIntent> {
  return request<PaymentIntent>('/api/kpay/start', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId, amount }),
  });
}

export async function getPaymentStatus(intentId: string): Promise<PaymentIntent> {
  return request<PaymentIntent>(`/api/kpay/status/${intentId}`);
}

export async function getTerminalConnection(): Promise<{ connected: boolean }> {
  return request<{ connected: boolean }>('/api/kpay/connection');
}
