import { useEffect, useMemo, useState } from 'react';
import { Gift, Plus, RefreshCw, Search, Ticket } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import {
  createVoucher,
  getCampaigns,
  getCustomers,
  getVouchers,
  issueVoucher,
} from '@/api/client';
import type { Campaign, Customer, Voucher, VoucherType } from '@/types';
import toast from 'react-hot-toast';

// --- Issue Voucher Modal (campaign-based) ---
function IssueVoucherModal({
  campaigns,
  customers,
  onClose,
  onDone,
}: {
  campaigns: Campaign[];
  customers: Customer[];
  onClose: () => void;
  onDone: () => void;
}) {
  const activeCampaigns = campaigns.filter((c) => c.status === 'active' || c.status === 'draft');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
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

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 20);
    const q = customerSearch.toLowerCase();
    return customers
      .filter((c) => (c.name || '').toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 20);
  }, [customers, customerSearch]);

  const handleIssue = async () => {
    if (!selectedCustomerId || !campaignId) return;
    setIssuing(true);
    try {
      const discountCents = discountOverride.trim()
        ? Math.round(parseFloat(discountOverride) * 100)
        : null;
      const voucher = await issueVoucher({
        customer_id: selectedCustomerId,
        campaign_id: campaignId,
        discount_cents: discountCents,
      });
      setResult({ code: voucher.code });
      onDone();
    } finally {
      setIssuing(false);
    }
  };

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  return (
    <Modal isOpen onClose={onClose} title="Issue Campaign Voucher">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-success">Voucher issued successfully</p>
          <div className="rounded-lg bg-gray-50 p-4 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Voucher Code</p>
            <p className="mt-1 font-mono text-lg font-bold text-text">{result.code}</p>
          </div>
          {selectedCustomer && (
            <p className="text-sm text-text-muted">
              Issued to {selectedCustomer.name || selectedCustomer.phone}
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Customer search */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">Customer</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search by name or phone…"
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setSelectedCustomerId(''); }}
                className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {selectedCustomer ? (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2 text-sm">
                <span>
                  <strong>{selectedCustomer.name || '—'}</strong>{' '}
                  <span className="text-text-muted">{selectedCustomer.phone}</span>
                </span>
                <button onClick={() => setSelectedCustomerId('')} className="text-xs text-text-muted hover:text-text">Change</button>
              </div>
            ) : (
              <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-gray-200">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCustomerId(c.id); setCustomerSearch(''); }}
                    className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium">{c.name || '—'}</span>
                    <span className="text-text-muted">{c.phone}</span>
                  </button>
                ))}
                {filteredCustomers.length === 0 && (
                  <p className="p-3 text-sm text-text-muted">No customers found</p>
                )}
              </div>
            )}
          </div>

          {/* Campaign dropdown */}
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
          </div>

          <Input
            label="Discount Override (SGD)"
            inputMode="decimal"
            value={discountOverride}
            onChange={(e) => setDiscountOverride(e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={issuing}>Cancel</Button>
            <Button onClick={handleIssue} disabled={issuing || !selectedCustomerId || !campaignId}>
              {issuing ? 'Issuing…' : 'Issue Voucher'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// --- Main Vouchers Page ---
export default function Vouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | VoucherType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'redeemed'>('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [showCreateCdc, setShowCreateCdc] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newAmount, setNewAmount] = useState('5.00');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params: any = {};
      if (typeFilter !== 'all') params.type = typeFilter;
      if (statusFilter !== 'all') params.redeemed = statusFilter === 'redeemed';
      if (campaignFilter !== 'all') params.campaign_id = campaignFilter;
      const [v, c, cust] = await Promise.all([getVouchers(params), getCampaigns(), getCustomers()]);
      setVouchers(v);
      setCampaigns(c);
      setCustomers(cust);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [typeFilter, statusFilter, campaignFilter]);

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

  async function handleCreateCdc() {
    const code = newCode.trim();
    const parsed = parseFloat(newAmount);
    const amount = Number.isFinite(parsed) ? parsed : 0;
    if (!code) { toast.error('Code is required'); return; }
    if (amount < 0) { toast.error('Amount must be zero or greater'); return; }
    setCreating(true);
    try {
      await createVoucher({ code, type: 'cdc', amount: amount || undefined });
      setShowCreateCdc(false);
      setNewCode('');
      setNewAmount('5.00');
      await load();
    } finally {
      setCreating(false);
    }
  }

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
          <p className="mt-1 text-sm text-text-muted">Campaign & CDC voucher management</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
          <Button variant="secondary" onClick={() => setShowCreateCdc(true)}>
            <Ticket className="h-4 w-4" />CDC
          </Button>
          <Button onClick={() => setShowIssue(true)}>
            <Gift className="h-4 w-4" />Issue Voucher
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
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
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">
            <option value="all">All</option>
            <option value="cdc">CDC</option>
            <option value="acre_group">Acre Group</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="redeemed">Redeemed</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">Campaign</label>
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">
            <option value="all">All</option>
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
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted">No vouchers found</td></tr>
              )}
              {filtered.map((v) => {
                const isRedeemed = !!v.redeemed_at;
                return (
                  <tr key={v.id} className="border-b border-gray-50 hover:bg-surface/40">
                    <td className="px-4 py-3 font-medium text-text">{v.code}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs ${v.type === 'cdc' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'}`}>
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
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${isRedeemed ? 'bg-error/10 text-error' : 'bg-success/10 text-success'}`}>
                        {isRedeemed ? 'Redeemed' : 'Available'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {isRedeemed ? (
                        <span>{v.staff_name || '—'}{v.outlet_id ? ` @ ${v.outlet_id.slice(0, 8)}` : ''}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {new Date(v.created_at).toLocaleDateString('en-SG')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* CDC Create Modal */}
      <Modal isOpen={showCreateCdc} onClose={() => setShowCreateCdc(false)} title="Create CDC Voucher">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">Voucher Code</label>
            <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="CDC-ABC123" autoFocus />
            <p className="mt-1 text-xs text-text-muted">Use a unique code, e.g. CDC-TEAM01</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">Amount (SGD)</label>
            <Input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateCdc(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreateCdc} disabled={creating || !newCode.trim()}>
              {creating ? 'Creating…' : 'Create Voucher'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Issue Campaign Voucher Modal */}
      {showIssue && (
        <IssueVoucherModal
          campaigns={campaigns}
          customers={customers}
          onClose={() => setShowIssue(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
