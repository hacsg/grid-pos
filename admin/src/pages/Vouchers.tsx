import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Ticket } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { createVoucher, getVouchers } from '@/api/client';
import type { Voucher, VoucherCreate, VoucherType } from '@/types';
import toast from 'react-hot-toast';

export default function Vouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | VoucherType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'redeemed'>('all');

  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newAmount, setNewAmount] = useState('5.00');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params: any = {};
      if (typeFilter !== 'all') params.type = typeFilter;
      if (statusFilter !== 'all') params.redeemed = statusFilter === 'redeemed';
      const data = await getVouchers(params);
      setVouchers(data);
    } catch {
      // errors toasted by client
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter]);

  const filtered = useMemo(() => vouchers, [vouchers]);

  async function handleCreate() {
    const code = newCode.trim();
    const amount = parseFloat(newAmount);
    if (!code) {
      toast.error('Code is required');
      return;
    }
    if (!amount || amount <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }
    setCreating(true);
    try {
      await createVoucher({ code, type: 'cdc', amount });
      setShowCreate(false);
      setNewCode('');
      setNewAmount('5.00');
      await load();
    } finally {
      setCreating(false);
    }
  }

  function formatAmount(v: Voucher) {
    const a = typeof v.amount === 'number' ? v.amount : parseFloat(String(v.amount || 0));
    return `S$${a.toFixed(2)}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Vouchers</h1>
          <p className="mt-1 text-sm text-text-muted">CDC and Acre Group voucher management</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            New CDC Voucher
          </Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="cdc">CDC</option>
              <option value="acre_group">Acre Group</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="available">Available</option>
              <option value="redeemed">Redeemed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Redeemed By / Outlet</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">Loading…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
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
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs ${v.type === 'cdc' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'}`}>
                        {v.type === 'cdc' ? 'CDC' : 'Acre Group'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{formatAmount(v)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${isRedeemed ? 'bg-error/10 text-error' : 'bg-success/10 text-success'}`}>
                        {isRedeemed ? 'Redeemed' : 'Available'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {isRedeemed ? (
                        <span>{v.staff_name || v.redeemed_by_staff_id || '—'}{v.outlet_id ? ` @ ${v.outlet_name || v.outlet_id}` : ''}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {v.order_id ? (v.order_number ? `#${v.order_number}` : v.order_id) : '—'}
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

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create CDC Voucher">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">Voucher Code</label>
            <Input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="CDC-ABC123"
              autoFocus
            />
            <p className="mt-1 text-xs text-text-muted">Use a unique code, e.g. CDC-TEAM01</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">Amount (SGD)</label>
            <Input
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newCode.trim()}>
              {creating ? 'Creating…' : 'Create Voucher'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
