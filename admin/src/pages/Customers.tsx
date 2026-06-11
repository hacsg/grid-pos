import { useEffect, useMemo, useState } from 'react';
import { Gift, RefreshCw, Search } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { getCustomers, getCampaigns, issueVoucher } from '@/api/client';
import type { Campaign, Customer } from '@/types';
import toast from 'react-hot-toast';

function campaignBadge(customer: Customer) {
  const campaign = customer.signup_campaign;
  if (!campaign) return <span className="text-text-muted">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
      {campaign.name}
    </span>
  );
}

// --- Issue Voucher Modal ---
function IssueVoucherModal({
  customer,
  campaigns,
  onClose,
}: {
  customer: Customer;
  campaigns: Campaign[];
  onClose: () => void;
}) {
  const activeCampaigns = campaigns.filter((c) => c.status === 'active' || c.status === 'draft');
  const [campaignId, setCampaignId] = useState(activeCampaigns[0]?.id ?? '');
  const [discountOverride, setDiscountOverride] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ code: string } | null>(null);

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);

  useEffect(() => {
    if (selectedCampaign) {
      setDiscountOverride(((selectedCampaign.discount_cents || 0) / 100).toFixed(2));
    }
  }, [selectedCampaign]);

  const handleIssue = async () => {
    if (!campaignId) return;
    setIssuing(true);
    try {
      const discountCents = discountOverride.trim()
        ? Math.round(parseFloat(discountOverride) * 100)
        : null;
      const voucher = await issueVoucher({
        customer_id: customer.id,
        campaign_id: campaignId,
        discount_cents: discountCents,
      });
      setResult({ code: voucher.code });
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Issue Voucher — ${customer.name || customer.phone}`}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-success">Voucher issued successfully</p>
          <div className="rounded-lg bg-gray-50 p-4 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Voucher Code</p>
            <p className="mt-1 font-mono text-lg font-bold text-text">{result.code}</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {activeCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code_prefix}) — S${(c.discount_cents / 100).toFixed(2)}
                </option>
              ))}
            </select>
            {activeCampaigns.length === 0 && (
              <p className="text-xs text-text-muted">No active campaigns. Create one first.</p>
            )}
          </div>

          <Input
            label="Discount Override (SGD)"
            inputMode="decimal"
            value={discountOverride}
            onChange={(e) => setDiscountOverride(e.target.value)}
            placeholder={selectedCampaign ? ((selectedCampaign.discount_cents / 100).toFixed(2)) : '0.00'}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={issuing}>Cancel</Button>
            <Button onClick={handleIssue} disabled={issuing || !campaignId}>
              {issuing ? 'Issuing…' : 'Issue Voucher'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [issuingCustomer, setIssuingCustomer] = useState<Customer | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [c, camp] = await Promise.all([getCustomers(), getCampaigns()]);
      setCustomers(c);
      setCampaigns(camp);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = customers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email || '').toLowerCase().includes(q)
      );
    }
    if (campaignFilter !== 'all') {
      if (campaignFilter === 'none') {
        list = list.filter((c) => !c.signup_campaign_id);
      } else {
        list = list.filter((c) => c.signup_campaign_id === campaignFilter);
      }
    }
    return list;
  }, [customers, search, campaignFilter]);

  const attributedCount = useMemo(
    () => customers.filter((c) => c.signup_campaign_id).length,
    [customers]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Customers</h1>
          <p className="mt-1 text-sm text-text-muted">Acre Club members & voucher recipients</p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4" />Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Customers</p>
          <p className="mt-2 text-2xl font-bold text-text">{customers.length}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Attributed to Campaign</p>
          <p className="mt-2 text-2xl font-bold text-text">{attributedCount}</p>
        </div>
      </div>

      {/* Search + Campaign filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name, phone, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">Campaign</label>
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All</option>
            <option value="none">No Campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Vouchers</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted">Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted">No customers found</td></tr>
              )}
              {filtered.map((customer) => (
                <tr key={customer.id} className="border-b border-gray-50 hover:bg-surface/40">
                  <td className="px-4 py-3 font-medium text-text">{customer.name || '—'}</td>
                  <td className="px-4 py-3">{customer.phone}</td>
                  <td className="px-4 py-3 text-text-muted">{customer.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium capitalize text-success">
                      {customer.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3">{customer.moments_total}</td>
                  <td className="px-4 py-3">{campaignBadge(customer)}</td>
                  <td className="px-4 py-3">{customer.voucher_count ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIssuingCustomer(customer)}
                      title="Issue voucher"
                    >
                      <Gift className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {issuingCustomer && (
        <IssueVoucherModal
          customer={issuingCustomer}
          campaigns={campaigns}
          onClose={() => setIssuingCustomer(null)}
        />
      )}
    </div>
  );
}
