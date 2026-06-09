import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { getCustomers } from '@/api/client';
import type { Customer } from '@/types';

function campaignBadge(customer: Customer) {
  const campaign = customer.signup_campaign;
  if (!campaign) {
    return <span className="text-text-muted">-</span>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
      {campaign.name}
    </span>
  );
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setCustomers(await getCustomers());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const attributedCount = useMemo(
    () => customers.filter((customer) => customer.signup_campaign_id).length,
    [customers]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Customers</h1>
          <p className="mt-1 text-sm text-text-muted">Acre Club / Plotholders accounts</p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Customers</p>
          <p className="mt-2 text-2xl font-bold text-text">{customers.length}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Attributed</p>
          <p className="mt-2 text-2xl font-bold text-text">{attributedCount}</p>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Moments</th>
                <th className="px-4 py-3">Signup Campaign</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    No customers found
                  </td>
                </tr>
              )}
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-gray-50 hover:bg-surface/40">
                  <td className="px-4 py-3 font-medium text-text">{customer.name || '-'}</td>
                  <td className="px-4 py-3">{customer.phone}</td>
                  <td className="px-4 py-3 text-text-muted">{customer.email || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium capitalize text-success">
                      {customer.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3">{customer.moments_total}</td>
                  <td className="px-4 py-3">{campaignBadge(customer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
