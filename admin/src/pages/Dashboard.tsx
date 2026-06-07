import { DollarSign, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';

const stats = [
  {
    label: 'Today\'s Sales',
    value: '$1,284.50',
    change: '+12.5%',
    icon: DollarSign,
    color: 'text-success',
    bg: 'bg-success/10',
  },
  {
    label: 'Orders Today',
    value: '42',
    change: '+8.2%',
    icon: ShoppingCart,
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    label: 'Avg. Order Value',
    value: '$30.58',
    change: '+3.1%',
    icon: TrendingUp,
    color: 'text-warning',
    bg: 'bg-warning/10',
    textColor: 'text-text',
  },
  {
    label: 'Active Staff',
    value: '8',
    change: '0%',
    icon: Users,
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
];

const recentOrders = [
  { id: '1', order: '#1042', customer: 'Walk-in', items: 3, total: '$24.50', status: 'Completed', time: '2 min ago' },
  { id: '2', order: '#1041', customer: 'Walk-in', items: 1, total: '$8.00', status: 'Completed', time: '15 min ago' },
  { id: '3', order: '#1040', customer: 'Walk-in', items: 5, total: '$42.75', status: 'Completed', time: '32 min ago' },
  { id: '4', order: '#1039', customer: 'Walk-in', items: 2, total: '$18.50', status: 'Pending', time: '1 hour ago' },
];

const orderColumns = [
  { key: 'order', header: 'Order' },
  { key: 'items', header: 'Items' },
  { key: 'total', header: 'Total' },
  {
    key: 'status',
    header: 'Status',
    render: (row: any) => (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        row.status === 'Completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
      }`}>
        {row.status}
      </span>
    ),
  },
  { key: 'time', header: 'Time' },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">Overview of today's performance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-muted">{stat.label}</p>
                <p className="stat-value mt-1">{stat.value}</p>
                <p className={`mt-1 text-xs font-medium ${stat.color}`}>{stat.change}</p>
              </div>
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Recent Orders">
          <Table
            columns={orderColumns}
            data={recentOrders}
            emptyMessage="No recent orders"
          />
        </Card>

        <Card title="Sales by Outlet">
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-surface/50">
            <div className="text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-text-muted" />
              <p className="mt-2 text-sm text-text-muted">Chart placeholder</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}