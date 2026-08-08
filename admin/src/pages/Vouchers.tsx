import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { getCampaigns, getVouchers } from '@/api/client';
import type { Campaign, Voucher, VoucherType } from '@/types';
import { formatSgtDate } from '@/utils/datetime';

// Read-only log of vouchers redeemed (or still available) at the till.
// Campaign issuance and "Create CDC voucher" were removed: POS validates every
// scanned code against Plotholders, so Grid-issued codes never redeem.

export default function Vouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | VoucherType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'redeemed'>('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params: {
        type?: 'cdc' | 'acre_group';
        redeemed?: boolean;
        campaign_id?: string;
      } = {};
      if (typeFilter !== 'all') params.type = typeFilter;
      if (statusFilter !== 'all') params.redeemed = statusFilter === 'redeemed';
      if (campaignFilter !== 'all') params.campaign_id = campaignFilter;
      const [v, c] = await Promise.all([getVouchers(params), getCampaigns()]);
      setVouchers(v);
      setCampaigns(c);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [typeFilter, statusFilter, campaignFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = search.toLowerCase();
    return vouchers.filter(
      (v) =>
        v.code.toLowerCase().includes(q) ||
        (v.customer_name || '').toLowerCase().includes(q) ||
        (v.customer_phone || '').includes(q) ||
        (v.campaign_name || '').toLowerCase().includes(q)
    );
  }, [vouchers, search]);

  function formatAmount(v: Voucher) {
    const a = typeof v.amount === 'number' ? v.amount : parseFloat(String(v.amount ?? 0));
    if (!a || a <= 0) return 'No value';
    return `S$${a.toFixed(2)}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Vouchers</h1>
          <p className="mt-1 text-sm text-text-muted">Vouchers redeemed at the till</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search code, customer, campaign…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">
            Type
          </label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | VoucherType)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All</option>
            <option value="cdc">CDC</option>
            <option value="acre_group">Acre Group</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'available' | 'redeemed')}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="redeemed">Redeemed</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">
            Campaign
          </label>
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Redeemed</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">
                    No vouchers found
                  </td>
                </tr>
              )}
              {filtered.map((v) => {
                const isRedeemed = !!v.redeemed_at;
                return (
                  <tr key={v.id} className="border-b border-gray-50 hover:bg-surface/40">
                    <td className="px-4 py-3 font-medium text-text">{v.code}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs ${
                          v.type === 'cdc' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'
                        }`}
                      >
                        {v.type === 'cdc' ? 'CDC' : 'Acre Group'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{formatAmount(v)}</td>
                    <td className="px-4 py-3">
                      {v.customer_name || v.customer_phone ? (
                        <div>
                          <p className="text-text">{v.customer_name || '—'}</p>
                          <p className="text-xs text-text-muted">{v.customer_phone || ''}</p>
                        </div>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.campaign_name ? (
                        <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {v.campaign_name}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isRedeemed ? 'bg-error/10 text-error' : 'bg-success/10 text-success'
                        }`}
                      >
                        {isRedeemed ? 'Redeemed' : 'Available'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {isRedeemed ? (
                        <span>
                          {v.staff_name || '—'}
                          {v.outlet_id ? ` @ ${v.outlet_id.slice(0, 8)}` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">{formatSgtDate(v.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
