import { useMemo, useState } from 'react';
import { Filter, RefreshCw, Undo2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useOrders, useOrder, useRefundOrder } from '@/hooks/useOrders';
import { useOutlets } from '@/hooks/useOutlets';
import { useStaffList } from '@/hooks/useStaff';
import type { Order, OrderStatus } from '@/types';

export default function Orders() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [outletFilter, setOutletFilter] = useState<string>('');

  const orderParams = useMemo(
    () => ({
      limit: 200,
      ...(statusFilter ? { status: statusFilter as OrderStatus } : {}),
      ...(outletFilter ? { outlet_id: outletFilter } : {}),
    }),
    [statusFilter, outletFilter],
  );

  const { data: ordersData, isLoading, refetch, isFetching } = useOrders(orderParams);
  const { data: outletsData } = useOutlets();
  const { data: staffData } = useStaffList({ limit: 500 });
  const { data: selectedOrder } = useOrder(selectedOrderId ?? '');
  const refundOrder = useRefundOrder();

  const outlets = outletsData?.data ?? [];
  const staffList = staffData?.data ?? [];
  const orders = ordersData?.data ?? [];

  const outletNameById = useMemo(
    () => Object.fromEntries(outlets.map((o) => [o.id, o.name])),
    [outlets],
  );
  const staffNameById = useMemo(
    () => Object.fromEntries(staffList.map((s) => [s.id, s.name])),
    [staffList],
  );

  const enrichedOrders = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        outlet_name: outletNameById[order.outlet_id] ?? order.outlet_id,
        staff_name: staffNameById[order.staff_id] ?? order.staff_id,
      })),
    [orders, outletNameById, staffNameById],
  );

  const handleRefund = (order: Order) => {
    if (order.status !== 'paid') return;
    if (!window.confirm(`Refund order #${order.order_number} for $${order.total.toFixed(2)}?`)) {
      return;
    }
    refundOrder.mutate(order.id, {
      onSuccess: () => setSelectedOrderId(null),
    });
  };

  const columns = [
    {
      key: 'order_number',
      header: 'Order',
      render: (order: Order) => (
        <span className="font-medium text-text">#{order.order_number}</span>
      ),
    },
    {
      key: 'outlet_name',
      header: 'Outlet',
      render: (order: Order) => (
        <span>{order.outlet_name ?? outletNameById[order.outlet_id] ?? '—'}</span>
      ),
    },
    {
      key: 'staff_name',
      header: 'Staff',
      render: (order: Order) => (
        <span>{order.staff_name ?? staffNameById[order.staff_id] ?? '—'}</span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      render: (order: Order) => (
        <span className="font-medium">${Number(order.total).toFixed(2)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order: Order) => {
        const colors: Record<string, string> = {
          paid: 'bg-success/10 text-success',
          pending: 'bg-warning/10 text-warning',
          cancelled: 'bg-error/10 text-error',
          refunded: 'bg-surface text-text-muted',
        };
        return (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors[order.status] || 'bg-surface text-text-muted'}`}
          >
            {order.status}
          </span>
        );
      },
    },
    {
      key: 'payment_method',
      header: 'Payment',
      render: (order: Order) => (
        <span className="capitalize text-text-muted">{order.payment_method ?? '—'}</span>
      ),
    },
  ];

  const detailOrder = selectedOrder
    ? {
        ...selectedOrder,
        outlet_name: outletNameById[selectedOrder.outlet_id] ?? selectedOrder.outlet_id,
        staff_name: staffNameById[selectedOrder.staff_id] ?? selectedOrder.staff_id,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Orders</h1>
          <p className="mt-1 text-sm text-text-muted">View and manage orders</p>
        </div>
        <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40 rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>

        <div className="relative">
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            className="w-48 rounded-lg border border-gray-200 bg-white py-2 px-4 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Outlets</option>
            {outlets.map((outlet) => (
              <option key={outlet.id} value={outlet.id}>
                {outlet.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <Table
          columns={columns}
          data={enrichedOrders}
          onRowClick={(order) => setSelectedOrderId(order.id)}
          emptyMessage="No orders found"
          loading={isLoading}
        />
      </Card>

      <Modal
        isOpen={!!selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        title={`Order #${detailOrder?.order_number ?? ''}`}
        size="lg"
      >
        {detailOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Outlet</p>
                <p className="text-sm font-medium text-text">{detailOrder.outlet_name}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Staff</p>
                <p className="text-sm font-medium text-text">{detailOrder.staff_name}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Status</p>
                <p className="text-sm font-medium text-text capitalize">{detailOrder.status}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Payment</p>
                <p className="text-sm font-medium text-text capitalize">
                  {detailOrder.payment_method ?? '—'}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Order Items</p>
              <div className="space-y-2">
                {(detailOrder.items ?? []).length === 0 ? (
                  <p className="text-sm text-text-muted">No line items</p>
                ) : (
                  detailOrder.items!.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-text">{item.product_name}</p>
                        <p className="text-xs text-text-muted">
                          x{item.quantity} @ ${Number(item.unit_price).toFixed(2)}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-text">
                        ${(Number(item.unit_price) * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <div className="space-y-0.5">
                <p className="text-sm text-text-muted">
                  Subtotal: ${Number(detailOrder.subtotal).toFixed(2)}
                </p>
                {Number(detailOrder.loyalty_discount ?? 0) > 0 && (
                  <p className="text-sm text-text-muted">
                    Loyalty: −${Number(detailOrder.loyalty_discount).toFixed(2)}
                  </p>
                )}
                {(detailOrder.applied_vouchers ?? []).map((voucher) => (
                  <p key={voucher.id} className="text-sm text-text-muted">
                    Voucher {voucher.code}: −${Number(voucher.amount_applied).toFixed(2)}
                  </p>
                ))}
                {Number(detailOrder.cdc_amount ?? 0) > 0 && (
                  <p className="text-sm text-text-muted">
                    CDC: −${Number(detailOrder.cdc_amount).toFixed(2)}
                  </p>
                )}
                <p className="text-lg font-bold text-text">
                  Total: ${Number(detailOrder.total).toFixed(2)}
                </p>
              </div>
              {detailOrder.status === 'paid' && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRefund(detailOrder)}
                  disabled={refundOrder.isPending}
                >
                  <Undo2 className="h-4 w-4" />
                  {refundOrder.isPending ? 'Refunding…' : 'Refund'}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}