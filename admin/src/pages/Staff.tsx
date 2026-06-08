import { useState, useMemo } from 'react';
import { Plus, KeyRound } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { useStaffList, useCreateStaff, useUpdateStaff, useResetStaffPin } from '@/hooks/useStaff';
import { useOutlets } from '@/hooks/useOutlets';
import type { Staff, StaffRole } from '@/types';

const ROLE_OPTIONS: StaffRole[] = ['admin', 'manager', 'cashier', 'supervisor'];

export default function Staff() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [resetPinStaff, setResetPinStaff] = useState<Staff | null>(null);
  const [newPin, setNewPin] = useState('');

  // form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('cashier');
  const [outletId, setOutletId] = useState('');
  const [pin, setPin] = useState('');

  const { data: staffData, isLoading: staffLoading } = useStaffList();
  const { data: outletsData, isLoading: outletsLoading } = useOutlets();

  const staffList = staffData?.data || [];
  const outlets = outletsData?.data || [];

  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff(editingStaff?.id || '');
  const resetPin = useResetStaffPin();

  // build outlet name map and enrich staff for display
  const outletMap = useMemo(() => {
    const m: Record<string, string> = {};
    outlets.forEach((o) => { m[o.id] = o.name; });
    return m;
  }, [outlets]);

  const staff = useMemo(() => staffList.map((s: Staff) => ({
    ...s,
    outlet_name: s.outlet_name || outletMap[s.outlet_id] || '—',
    active: s.active ?? s.is_active ?? true,
  })), [staffList, outletMap]);

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (s: Staff) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {s.name.split(' ').map((n: string) => n[0]).join('')}
          </div>
          <div>
            <p className="font-medium text-text">{s.name}</p>
            <p className="text-xs text-text-muted">{s.email || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (s: Staff) => (
        <span className="inline-flex items-center rounded-full bg-primary/5 px-2.5 py-0.5 text-xs font-medium capitalize text-primary">
          {s.role}
        </span>
      ),
    },
    { key: 'outlet_name', header: 'Outlet' },
    {
      key: 'active',
      header: 'Status',
      render: (s: Staff) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          s.active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.active ? 'bg-success' : 'bg-error'}`} />
          {s.active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (s: Staff) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(s); }}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); openResetPin(s); }}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <KeyRound className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  function openCreate() {
    setEditingStaff(null);
    setName('');
    setEmail('');
    setRole('cashier');
    setOutletId(outlets[0]?.id || '');
    setPin('');
    setIsFormOpen(true);
  }

  function openEdit(s: Staff) {
    setEditingStaff(s);
    setName(s.name || '');
    setEmail(s.email || '');
    setRole(s.role);
    setOutletId(s.outlet_id || '');
    setPin('');
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingStaff(null);
  }

  function openResetPin(s: Staff) {
    setResetPinStaff(s);
    setNewPin('');
    setIsPinModalOpen(true);
  }

  function closePinModal() {
    setIsPinModalOpen(false);
    setResetPinStaff(null);
    setNewPin('');
  }

  async function handleSubmit() {
    if (!name.trim() || !outletId) return;
    if (!editingStaff && pin.length !== 4) return;

    const payload: any = {
      name: name.trim(),
      role,
      outlet_id: outletId,
    };
    if (email.trim()) payload.email = email.trim();
    if (!editingStaff && pin) payload.pin = pin;

    if (editingStaff) {
      updateStaff.mutate(payload, { onSuccess: () => closeForm() });
    } else {
      createStaff.mutate(payload, { onSuccess: () => closeForm() });
    }
  }

  async function handleResetPin() {
    if (!resetPinStaff || newPin.length !== 4) return;
    resetPin.mutate(
      { id: resetPinStaff.id, pin: newPin },
      { onSuccess: () => closePinModal() }
    );
  }

  const isSubmitting = createStaff.isPending || updateStaff.isPending || resetPin.isPending;
  const loading = staffLoading || outletsLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Staff</h1>
          <p className="mt-1 text-sm text-text-muted">Manage staff accounts and access</p>
        </div>
        <Button onClick={openCreate} disabled={outlets.length === 0}>
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          data={staff as any}
          loading={loading}
          emptyMessage="No staff found"
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingStaff ? 'Edit Staff' : 'Add Staff'}
      >
        <div className="space-y-4">
          <Input
            label="Full Name"
            placeholder="e.g. Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Email (optional)"
            type="email"
            placeholder="jane@gridpos.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Outlet</label>
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {!editingStaff && (
            <Input
              label="PIN (4 digits)"
              type="password"
              maxLength={4}
              placeholder="****"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={closeForm} disabled={isSubmitting}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={!name.trim() || !outletId || (!editingStaff && pin.length !== 4)}
            >
              {editingStaff ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isPinModalOpen}
        onClose={closePinModal}
        title="Reset PIN"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Reset PIN for <strong>{resetPinStaff?.name}</strong>
          </p>
          <Input
            label="New PIN (4 digits)"
            type="password"
            maxLength={4}
            placeholder="****"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={closePinModal} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleResetPin} loading={isSubmitting} disabled={newPin.length !== 4}>
              Reset PIN
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}