import { useState } from 'react';
import { Filter, RefreshCw, Undo2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import type { Order, OrderStatus } from '@/types';

const mockOrders: Order[] = [
  {
    id: '1', order_number: '1042', outlet_id: '1', outlet_name: 'Main Street',
    staff_id: '1', staff_name: 'Alice', items: [
      { id: '1', product_id: '1', product_name: 'Classic Gelato', quantity: 2, unit_price: 6.00, total_price: 12.00, modifiers: [] },
    ],
    subtotal: 12.00, tax: 1.20, total: 13.20, status: 'completed', payment_method: 'cash', created_at: '2024-01-15T14:30:00Z', updated_at: '2024-01-15T14:30:00Z',
  },
  {
    id: '2', order_number: '1041', outlet_id: '2', outlet_name: 'Downtown',
    staff_id: '2', staff_name: 'Bob', items: [],
    subtotal: 8.00, tax: 0.80, total: 8.80, status: 'pending', payment_method: 'card', created_at: '2024-01-15T14:15:00Z', updated_at: '2024-01-15T14:15:00Z',
  },
];

export default function Orders() {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [outletFilter, setOutletFilter] = useState<string>('');

  const filteredOrders = mockOrders.filter((order) => {
    if (statusFilter && order.status !== statusFilter) return false;
    if (outletFilter && order.outlet_id !== outletFilter) return false;
    return true;
  });

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Orders</h1>
          <p className="mt-1 text-sm text-text-muted">View and manage orders</p>
        </div>
        <Button variant="secondary">
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
            <option value="1">Main Street</option>
            <option value="2">Downtown</option>
          </select>
        </div>
      </div>

      <Card>
        <Table
          columns={columns}
          data={filteredOrders}
          onRowClick={setSelectedOrder}
          emptyMessage="No orders found"
        />
      </Card>

      <Modal
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
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
                {selectedOrder.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-text">{item.product_name}</p>
                      <p className="text-xs text-text-muted">x{item.quantity} @ ${item.unit_price.toFixed(2)}</p>
                    </div>
                    <span className="text-sm font-medium text-text">${item.total_price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <div>
                <p className="text-sm text-text-muted">Subtotal: ${selectedOrder.subtotal.toFixed(2)}</p>
                <p className="text-sm text-text-muted">Tax: ${selectedOrder.tax.toFixed(2)}</p>
                <p className="text-lg font-bold text-text">Total: ${selectedOrder.total.toFixed(2)}</p>
              </div>
              {selectedOrder.status !== 'refunded' && (
                <Button variant="danger" size="sm">
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