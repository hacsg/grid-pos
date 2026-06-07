import { useState } from 'react';
import { Download, BarChart3, TrendingUp, Users, Store } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const salesByOutletData = [
  { outlet: 'Main Street', sales: 4820, orders: 156 },
  { outlet: 'Downtown', sales: 3210, orders: 108 },
];

const topProductsData = [
  { product: 'Classic Gelato', quantity: 89, revenue: 534 },
  { product: 'Chocolate Dream', quantity: 72, revenue: 432 },
  { product: 'Strawberry Bliss', quantity: 65, revenue: 390 },
  { product: 'Mango Sorbet', quantity: 54, revenue: 324 },
  { product: 'Pistachio', quantity: 48, revenue: 288 },
];

const staffPerformanceData = [
  { staff: 'Alice J.', orders: 42, sales: 1260 },
  { staff: 'Bob S.', orders: 38, sales: 1140 },
  { staff: 'Carol D.', orders: 35, sales: 1050 },
  { staff: 'Dave W.', orders: 28, sales: 840 },
];

export default function Reports() {
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-01-31');

  const handleExport = () => {
    console.log('Export CSV:', { startDate, endDate });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">Sales analytics and performance data</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Input
          label="Start Date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label="End Date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Sales by Outlet */}
        <Card title="Sales by Outlet" subtitle="Revenue and order count per location">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesByOutletData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="outlet" tick={{ fontSize: 12, fill: '#6C757D' }} />
                <YAxis tick={{ fontSize: 12, fill: '#6C757D' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #eee', fontSize: '13px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="sales" name="Sales ($)" fill="#2D5F5D" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" name="Orders" fill="#6C757D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top Products */}
        <Card title="Top Products" subtitle="Best-selling items this period">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProductsData} layout="vertical" barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#6C757D' }} />
                <YAxis dataKey="product" type="category" tick={{ fontSize: 12, fill: '#1A1A1A' }} width={140} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #eee', fontSize: '13px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="revenue" name="Revenue ($)" fill="#2D5F5D" radius={[0, 4, 4, 0]} />
                <Bar dataKey="quantity" name="Qty Sold" fill="#FFC107" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Staff Performance */}
        <Card title="Staff Performance" subtitle="Order count and sales by staff member">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={staffPerformanceData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="staff" tick={{ fontSize: 12, fill: '#6C757D' }} />
                <YAxis tick={{ fontSize: 12, fill: '#6C757D' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #eee', fontSize: '13px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="sales" name="Sales ($)" fill="#2D5F5D" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" name="Orders" fill="#6C757D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Summary */}
        <Card title="Summary" subtitle="Key metrics for selected period">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-primary">
                  <Store className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Total Sales</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-text">$8,030</p>
              </div>
              <div className="rounded-lg bg-success/5 p-4">
                <div className="flex items-center gap-2 text-success">
                  <BarChart3 className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Total Orders</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-text">264</p>
              </div>
              <div className="rounded-lg bg-warning/5 p-4">
                <div className="flex items-center gap-2 text-warning">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Avg Order</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-text">$30.42</p>
              </div>
              <div className="rounded-lg bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-primary">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Top Staff</span>
                </div>
                <p className="mt-2 text-lg font-bold text-text">Alice J.</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}