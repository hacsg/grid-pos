import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import {
  createCampaign,
  getCampaignMetrics,
  getCampaigns,
  updateCampaign,
} from '@/api/client';
import type { Campaign, CampaignFormData, CampaignMetrics } from '@/types';

type MetricsMap = Record<string, CampaignMetrics>;

const statusOptions = ['draft', 'active', 'paused', 'ended'];

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
  const [signupDiscount, setSignupDiscount] = useState(
    centsToDollars(campaign?.signup_voucher_discount_cents)
  );

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
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Campaign Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <Input
          label="Code Prefix"
          value={codePrefix}
          onChange={(e) => setCodePrefix(e.target.value)}
          required
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Budget (SGD)"
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
        <Input
          label="Default Discount (SGD)"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          required
        />
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

      <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-3 text-sm text-text">
        <input
          type="checkbox"
          checked={autoIssue}
          onChange={(e) => setAutoIssue(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
        Auto-issue on signup
      </label>

      {autoIssue && (
        <Input
          label="Signup Voucher Discount (SGD)"
          inputMode="decimal"
          value={signupDiscount}
          onChange={(e) => setSignupDiscount(e.target.value)}
        />
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {campaign ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<MetricsMap>({});
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
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

  async function load() {
    setLoading(true);
    try {
      const nextCampaigns = await getCampaigns();
      setCampaigns(nextCampaigns);
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

  useEffect(() => {
    load();
  }, []);

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingCampaign(null);
  };

  const handleSubmit = async (data: CampaignFormData) => {
    setSaving(true);
    try {
      if (editingCampaign) {
        await updateCampaign(editingCampaign.id, data);
      } else {
        await createCampaign(data);
      }
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
          <p className="mt-1 text-sm text-text-muted">Signup attribution and voucher settings</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="h-4 w-4" />
            Campaign
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Campaigns</p>
          <p className="mt-2 text-2xl font-bold text-text">{campaigns.length}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Signups</p>
          <p className="mt-2 text-2xl font-bold text-text">{totals.signups}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Auto-issued</p>
          <p className="mt-2 text-2xl font-bold text-text">{totals.issued}</p>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Auto-issue</th>
                <th className="px-4 py-3">Signups</th>
                <th className="px-4 py-3">Vouchers</th>
                <th className="px-4 py-3">Conversion</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-text-muted">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && campaigns.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-text-muted">
                    No campaigns found
                  </td>
                </tr>
              )}
              {campaigns.map((campaign) => {
                const item = metrics[campaign.id];
                return (
                  <tr key={campaign.id} className="border-b border-gray-50 hover:bg-surface/40">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-text">{campaign.name}</p>
                        <p className="text-xs text-text-muted">
                          {campaign.code_prefix}
                          {campaign.channel ? ` - ${campaign.channel}` : ''}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(campaign.status)}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{formatMoney(campaign.budget_cents)}</td>
                    <td className="px-4 py-3">{formatMoney(campaign.discount_cents)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${campaign.auto_issue_on_signup ? 'bg-success/10 text-success' : 'bg-gray-100 text-text-muted'}`}>
                        {campaign.auto_issue_on_signup ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{item?.total_signups ?? 0}</td>
                    <td className="px-4 py-3">{item?.vouchers_auto_issued ?? 0}</td>
                    <td className="px-4 py-3">
                      {(item?.signup_purchase_conversion_rate ?? 0).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingCampaign(campaign);
                          setIsFormOpen(true);
                        }}
                        aria-label={`Edit ${campaign.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingCampaign ? 'Edit Campaign' : 'Create Campaign'}
        size="lg"
      >
        <CampaignForm
          key={editingCampaign?.id ?? 'new'}
          campaign={editingCampaign}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          isSubmitting={saving}
        />
      </Modal>
    </div>
  );
}
