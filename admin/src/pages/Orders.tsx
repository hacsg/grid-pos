import { useState, useMemo } from 'react';
import { Filter, RefreshCw, Undo2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useOrders, useOrder, useRefundOrder } from '@/hooks/useOrders';
import { useOutlets } from '@/hooks/useOutlets';
import type { Order, OrderStatus } from '@/types';

export default function Orders() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [outletFilter, setOutletFilter] = useState<string>('');

  const { data: outletsData } = useOutlets();
  const outlets = outletsData?.data || [];

  const ordersParams = useMemo(() => ({
    limit: 200,
    ...(outletFilter ? { outlet_id: outletFilter } : {}),
    ...(statusFilter ? { status: statusFilter as OrderStatus } : {}),
  }), [outletFilter, statusFilter]);

  const { data: ordersData, isLoading, refetch } = useOrders(ordersParams);
  const { data: fullOrder } = useOrder(selectedOrderId || '');
  const refundOrder = useRefundOrder();

  const outletMap = useMemo(() => {
    const m: Record<string, string> = {};
    outlets.forEach((o) => { m[o.id] = o.name; });
    return m;
  }, [outlets]);

  const rawOrders: Order[] = ordersData?.data || [];

  // enrich with names (backend list does not include *_name)
  const orders = useMemo(() => rawOrders.map((o) => ({
    ...o,
    outlet_name: o.outlet_name || outletMap[o.outlet_id] || '—',
    staff_name: o.staff_name || '—',
  })), [rawOrders, outletMap]);

  // selected display: prefer full order (has items) merged with enriched names
  const selectedOrder: Order | null = useMemo(() => {
    if (!selectedOrderId) return null;
    const base = orders.find((o) => o.id === selectedOrderId) || fullOrder;
    if (!base) return null;
    return {
      ...base,
      outlet_name: base.outlet_name || outletMap[base.outlet_id] || '—',
      staff_name: base.staff_name || '—',
      items: (fullOrder?.items || base.items || []),
    } as Order;
  }, [selectedOrderId, orders, fullOrder, outletMap]);

  const columns = [
    {
      key: 'order_number',
      header: 'Order',
      render: (order: Order) => (
        <span className="font-medium text-text">#{order.order_number}</span>
      ),
    },
    { key: 'outlet_name', header: 'Outlet' },
    {
      key: 'staff_name',
      header: 'Staff',
    },
    {
      key: 'total',
      header: 'Total',
      render: (order: Order) => (
        <span className="font-medium">${order.total.toFixed(2)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order: Order) => {
        const colors: Record<string, string> = {
          completed: 'bg-success/10 text-success',
          paid: 'bg-success/10 text-success',
          pending: 'bg-warning/10 text-warning',
          cancelled: 'bg-error/10 text-error',
          refunded: 'bg-surface text-text-muted',
        };
        return (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors[order.status] || 'bg-surface text-text-muted'}`}>
            {order.status}
          </span>
        );
      },
    },
    {
      key: 'payment_method',
      header: 'Payment',
      render: (order: Order) => (
        <span className="capitalize text-text-muted">{order.payment_method}</span>
      ),
    },
  ];

  function handleRowClick(order: Order) {
    setSelectedOrderId(order.id);
  }

  function closeDetail() {
    setSelectedOrderId(null);
  }

  function handleRefresh() {
    refetch();
  }

  function handleRefund() {
    if (!selectedOrderId) return;
    refundOrder.mutate(selectedOrderId, {
      onSuccess: () => {
        // keep modal open or close; refresh will update list
        refetch();
      },
    });
  }

  const isRefunding = refundOrder.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Orders</h1>
          <p className="mt-1 text-sm text-text-muted">View and manage orders</p>
        </div>
        <Button variant="secondary" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4" />
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
            <option value="completed">Completed</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>

        <div className="relative">
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            className="w-40 rounded-lg border border-gray-200 bg-white py-2 px-4 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <Table
          columns={columns}
          data={orders as any}
          loading={isLoading}
          onRowClick={handleRowClick}
          emptyMessage="No orders found"
        />
      </Card>

      <Modal
        isOpen={!!selectedOrderId}
        onClose={closeDetail}
        title={`Order #${selectedOrder?.order_number}`}
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Outlet</p>
                <p className="text-sm font-medium text-text">{selectedOrder.outlet_name}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Staff</p>
                <p className="text-sm font-medium text-text">{selectedOrder.staff_name}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Status</p>
                <p className="text-sm font-medium text-text capitalize">{selectedOrder.status}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider">Payment</p>
                <p className="text-sm font-medium text-text capitalize">{selectedOrder.payment_method}</p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Order Items</p>
              <div className="space-y-2">
                {(selectedOrder.items || []).length > 0 ? (
                  selectedOrder.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-text">{item.product_name}</p>
                        <p className="text-xs text-text-muted">x{item.quantity} @ ${item.unit_price.toFixed(2)}</p>
                      </div>
                      <span className="text-sm font-medium text-text">${item.total_price.toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-muted">No item details available.</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <div>
                <p className="text-sm text-text-muted">Subtotal: ${selectedOrder.subtotal.toFixed(2)}</p>
                <p className="text-sm text-text-muted">Tax: ${selectedOrder.tax.toFixed(2)}</p>
                <p className="text-lg font-bold text-text">Total: ${selectedOrder.total.toFixed(2)}</p>
              </div>
              {selectedOrder.status !== 'refunded' && (
                <Button variant="danger" size="sm" onClick={handleRefund} loading={isRefunding}>
                  <Undo2 className="h-4 w-4" />
                  Refund
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}