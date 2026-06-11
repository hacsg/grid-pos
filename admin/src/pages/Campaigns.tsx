import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronDown, ChevronRight, Gift, Pencil, Plus, RefreshCw } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import {
  bulkIssueVouchers,
  createCampaign,
  getCampaignMetrics,
  getCampaigns,
  getCustomers,
  updateCampaign,
} from '@/api/client';
import type { Campaign, CampaignFormData, CampaignMetrics, Customer } from '@/types';
import toast from 'react-hot-toast';

type MetricsMap = Record<string, CampaignMetrics>;

const statusOptions = ['draft', 'active', 'paused', 'ended'];
const statusFilters = ['all', ...statusOptions];

const centsToDollars = (cents?: number | null) =>
  cents == null ? '' : (cents / 100).toFixed(2);

const dollarsToCents = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
};

const formatMoney = (cents?: number | null) =>
  cents == null ? '-' : `S$${(cents / 100).toFixed(2)}`;

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'active') return 'bg-success/10 text-success';
  if (normalized === 'paused') return 'bg-warning/20 text-amber-700';
  if (normalized === 'ended') return 'bg-gray-100 text-text-muted';
  return 'bg-primary/10 text-primary';
}

// --- Collapsible Section ---
function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-text"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
      </button>
      {open && <div className="border-t border-gray-100 px-4 py-4">{children}</div>}
    </div>
  );
}

// --- Issue Vouchers Modal ---
function IssueVouchersModal({
  campaign,
  customers,
  onClose,
  onDone,
}: {
  campaign: Campaign;
  customers: Customer[];
  onClose: () => void;
  onDone: () => void;
}) {
  const campaignCustomers = useMemo(
    () => customers.filter((c) => c.signup_campaign_id === campaign.id),
    [customers, campaign.id]
  );
  const [mode, setMode] = useState<'all' | 'select'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discountOverride, setDiscountOverride] = useState(centsToDollars(campaign.discount_cents));
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ issued: number; codes: string[] } | null>(null);

  const toggleCustomer = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleIssue = async () => {
    setIssuing(true);
    try {
      const discountCents = dollarsToCents(discountOverride);
      const res = await bulkIssueVouchers({
        campaign_id: campaign.id,
        customer_ids: mode === 'all' ? null : Array.from(selected),
        discount_cents: discountCents,
      });
      setResult(res);
      onDone();
    } finally {
      setIssuing(false);
    }
  };

  const count = mode === 'all' ? campaignCustomers.length : selected.size;

  return (
    <Modal isOpen onClose={onClose} title={`Issue Vouchers — ${campaign.name}`} size="lg">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-success">
            Issued {result.issued} voucher{result.issued === 1 ? '' : 's'}
          </p>
          <div className="max-h-48 overflow-y-auto rounded-lg bg-gray-50 p-3 font-mono text-xs">
            {result.codes.map((code) => (
              <div key={code}>{code}</div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-3 text-sm">
              <input
                type="radio"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
                className="text-primary"
              />
              Issue to all {campaignCustomers.length} signup{campaignCustomers.length === 1 ? '' : 's'}
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-3 text-sm">
              <input
                type="radio"
                checked={mode === 'select'}
                onChange={() => setMode('select')}
                className="text-primary"
              />
              Select specific customers
            </label>
          </div>

          {mode === 'select' && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
              {campaignCustomers.length === 0 && (
                <p className="p-3 text-sm text-text-muted">No customers signed up via this campaign</p>
              )}
              {campaignCustomers.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-gray-50 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggleCustomer(c.id)}
                    className="rounded border-gray-300 text-primary"
                  />
                  <span className="font-medium">{c.name || '—'}</span>
                  <span className="text-text-muted">{c.phone}</span>
                </label>
              ))}
            </div>
          )}

          <Input
            label="Discount Override (SGD)"
            inputMode="decimal"
            value={discountOverride}
            onChange={(e) => setDiscountOverride(e.target.value)}
            placeholder={centsToDollars(campaign.discount_cents)}
          />

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-text-muted">
              {count} customer{count === 1 ? '' : 's'} will receive a voucher
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleIssue} disabled={issuing || count === 0}>
                {issuing ? 'Issuing…' : `Issue ${count} Voucher${count === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// --- Campaign Form ---
interface CampaignFormProps {
  campaign: Campaign | null;
  onSubmit: (data: CampaignFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function CampaignForm({ campaign, onSubmit, onCancel, isSubmitting }: CampaignFormProps) {
  const [name, setName] = useState(campaign?.name ?? '');
  const [channel, setChannel] = useState(campaign?.channel ?? '');
  const [codePrefix, setCodePrefix] = useState(campaign?.code_prefix ?? '');
  const [status, setStatus] = useState(campaign?.status ?? 'draft');
  const [budget, setBudget] = useState(centsToDollars(campaign?.budget_cents));
  const [discount, setDiscount] = useState(centsToDollars(campaign?.discount_cents ?? 0));
  const [startDate, setStartDate] = useState(campaign?.start_date ?? '');
  const [endDate, setEndDate] = useState(campaign?.end_date ?? '');
  const [autoIssue, setAutoIssue] = useState(campaign?.auto_issue_on_signup ?? false);
  const [signupDiscount, setSignupDiscount] = useState(centsToDollars(campaign?.signup_voucher_discount_cents));
  const [voucherStyle, setVoucherStyle] = useState<string | null>(campaign?.voucher_style ?? null);
  const [voucherAccentColor, setVoucherAccentColor] = useState(campaign?.voucher_accent_color ?? '');
  const [voucherHeadline, setVoucherHeadline] = useState(campaign?.voucher_headline ?? '');
  const [voucherBackgroundUrl, setVoucherBackgroundUrl] = useState(campaign?.voucher_background_url ?? '');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const discountCents = dollarsToCents(discount);
    if (!name.trim() || !codePrefix.trim() || discountCents == null) return;
    onSubmit({
      name: name.trim(),
      channel: channel.trim() || null,
      code_prefix: codePrefix.trim(),
      budget_cents: dollarsToCents(budget),
      discount_cents: discountCents,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      auto_issue_on_signup: autoIssue,
      signup_voucher_discount_cents: autoIssue ? dollarsToCents(signupDiscount) : null,
      voucher_style: voucherStyle,
      voucher_accent_color: voucherAccentColor.trim() || null,
      voucher_headline: voucherHeadline.trim() || null,
      voucher_background_url: voucherBackgroundUrl.trim() || null,
    });
  };

  const previewAccent = voucherAccentColor.trim() || '#0B1F3A';
  const previewHeadline = voucherHeadline.trim() || 'Voucher';
  const previewStyle = voucherStyle ?? 'classic';
  const previewDiscountCents = dollarsToCents(discount) ?? 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Section title="Campaign Setup" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Campaign Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="instagram, tiktok, etc." />
          <Input label="Code Prefix" value={codePrefix} onChange={(e) => setCodePrefix(e.target.value)} required placeholder="IG06" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <Input label="Budget (SGD)" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <Input label="Default Discount (SGD)" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} required />
          <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </Section>

      <Section title="Voucher Settings">
        <div className="space-y-4">
          <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-3 text-sm text-text">
            <input type="checkbox" checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
            Auto-issue voucher on customer signup
          </label>
          {autoIssue && (
            <Input label="Signup Voucher Discount (SGD)" inputMode="decimal" value={signupDiscount} onChange={(e) => setSignupDiscount(e.target.value)} />
          )}
        </div>
      </Section>

      <Section title="Voucher Design">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Style</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {['classic', 'perforated', 'stamp-card', 'raffle-ticket'].map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setVoucherStyle(style === 'classic' ? null : style)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                    (style === 'classic' && !voucherStyle) || voucherStyle === style
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-gray-200 bg-white text-text-muted hover:border-gray-300'
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>
          <Input label="Accent Color (hex)" value={voucherAccentColor} onChange={(e) => setVoucherAccentColor(e.target.value)} placeholder="#8B4513" />
          <Input label="Headline" value={voucherHeadline} onChange={(e) => setVoucherHeadline(e.target.value)} placeholder="FREE SCOOP" />
          <Input label="Background Image URL" value={voucherBackgroundUrl} onChange={(e) => setVoucherBackgroundUrl(e.target.value)} placeholder="https://..." />
          <div className="overflow-hidden rounded-lg border bg-white" style={{ borderColor: previewAccent }}>
            <div className="flex min-h-[112px]">
              <div className="flex w-24 shrink-0 flex-col justify-between border-r-2 border-dashed p-3 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: previewAccent, color: previewAccent }}>
                <span>{codePrefix.trim() || 'CODE'}</span>
                <span>{previewStyle}</span>
              </div>
              <div className="flex flex-1 flex-col justify-center p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{name.trim() || 'Campaign'}</p>
                <p className="mt-1 text-xl font-black uppercase text-text" style={{ color: previewAccent }}>{previewHeadline}</p>
                <p className="mt-2 text-sm text-text-muted">{formatMoney(previewDiscountCents)}</p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isSubmitting}>{campaign ? 'Update' : 'Create'}</Button>
      </div>
    </form>
  );
}

// --- Main Page ---
export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<MetricsMap>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [issuingCampaign, setIssuingCampaign] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(
    () =>
      Object.values(metrics).reduce(
        (acc, item) => ({
          signups: acc.signups + item.total_signups,
          issued: acc.issued + item.vouchers_auto_issued,
        }),
        { signups: 0, issued: 0 }
      ),
    [metrics]
  );

  const filteredCampaigns = useMemo(
    () => (statusFilter === 'all' ? campaigns : campaigns.filter((c) => c.status === statusFilter)),
    [campaigns, statusFilter]
  );

  async function load() {
    setLoading(true);
    try {
      const [nextCampaigns, nextCustomers] = await Promise.all([getCampaigns(), getCustomers()]);
      setCampaigns(nextCampaigns);
      setCustomers(nextCustomers);
      const metricEntries = await Promise.all(
        nextCampaigns.map(async (campaign) => {
          const item = await getCampaignMetrics(campaign.id);
          return [campaign.id, item] as const;
        })
      );
      setMetrics(Object.fromEntries(metricEntries));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const closeForm = () => { setIsFormOpen(false); setEditingCampaign(null); };

  const handleSubmit = async (data: CampaignFormData) => {
    setSaving(true);
    try {
      if (editingCampaign) await updateCampaign(editingCampaign.id, data);
      else await createCampaign(data);
      closeForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Campaigns</h1>
          <p className="mt-1 text-sm text-text-muted">Ad attribution, signup tracking & voucher campaigns</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button onClick={() => setIsFormOpen(true)}><Plus className="h-4 w-4" />Campaign</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Campaigns</p>
          <p className="mt-2 text-2xl font-bold text-text">{campaigns.length}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Total Signups</p>
          <p className="mt-2 text-2xl font-bold text-text">{totals.signups}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Auto-issued</p>
          <p className="mt-2 text-2xl font-bold text-text">{totals.issued}</p>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-50 p-1">
        {statusFilters.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              statusFilter === s ? 'bg-white text-text shadow-sm' : 'text-text-muted hover:text-text'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Auto-issue</th>
                <th className="px-4 py-3">Signups</th>
                <th className="px-4 py-3">Vouchers</th>
                <th className="px-4 py-3">Conversion</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted">Loading...</td></tr>
              )}
              {!loading && filteredCampaigns.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-text-muted">No campaigns found</td></tr>
              )}
              {filteredCampaigns.map((campaign) => {
                const item = metrics[campaign.id];
                return (
                  <tr key={campaign.id} className="border-b border-gray-50 hover:bg-surface/40">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-text">{campaign.name}</p>
                        <p className="text-xs text-text-muted">
                          {campaign.code_prefix}{campaign.channel ? ` · ${campaign.channel}` : ''}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(campaign.status)}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{formatMoney(campaign.discount_cents)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${campaign.auto_issue_on_signup ? 'bg-success/10 text-success' : 'bg-gray-100 text-text-muted'}`}>
                        {campaign.auto_issue_on_signup ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{item?.total_signups ?? 0}</td>
                    <td className="px-4 py-3">{item?.vouchers_auto_issued ?? 0}</td>
                    <td className="px-4 py-3">{(item?.signup_purchase_conversion_rate ?? 0).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIssuingCampaign(campaign)}
                          aria-label={`Issue vouchers for ${campaign.name}`}
                          title="Issue vouchers"
                        >
                          <Gift className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingCampaign(campaign); setIsFormOpen(true); }}
                          aria-label={`Edit ${campaign.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={isFormOpen} onClose={closeForm} title={editingCampaign ? 'Edit Campaign' : 'Create Campaign'} size="lg">
        <CampaignForm key={editingCampaign?.id ?? 'new'} campaign={editingCampaign} onSubmit={handleSubmit} onCancel={closeForm} isSubmitting={saving} />
      </Modal>

      {issuingCampaign && (
        <IssueVouchersModal
          campaign={issuingCampaign}
          customers={customers}
          onClose={() => setIssuingCampaign(null)}
          onDone={() => {}}
        />
      )}
    </div>
  );
}
