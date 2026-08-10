import { useState } from 'react';
import { Plus, KeyRound, Pencil, Trash2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import {
  useStaffList,
  useCreateStaff,
  useUpdateStaff,
  useDeleteStaff,
  useResetStaffPin,
} from '@/hooks/useStaff';
import { useOutlets } from '@/hooks/useOutlets';
import type { Staff, StaffFormData, StaffRole } from '@/types';

interface StaffFormProps {
  staff: Staff | null;
  outlets: { id: string; name: string }[];
  onSubmit: (data: StaffFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function StaffForm({ staff, outlets, onSubmit, onCancel, isSubmitting }: StaffFormProps) {
  const [name, setName] = useState(staff?.name ?? '');
  const [role, setRole] = useState<StaffRole>(staff?.role ?? 'cashier');
  const [outletId, setOutletId] = useState(staff?.outlet_id ?? outlets[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [isActive, setIsActive] = useState(staff?.active ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !outletId) return;
    if (!staff && pin.length !== 4) return;

    const data: StaffFormData = {
      name: name.trim(),
      role,
      outlet_id: outletId,
      is_active: isActive,
    };
    if (!staff) {
      data.pin = pin;
    }
    onSubmit(data);
  };

  return (
    <form key={staff?.id ?? 'new'} onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Full Name"
        placeholder="e.g. Jane Doe"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="supervisor">Supervisor</option>
          <option value="cashier">Cashier</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text">Outlet</label>
        <select
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        >
          {outlets.map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
            </option>
          ))}
        </select>
      </div>

      {!staff && (
        <Input
          label="PIN (4 digits)"
          type="password"
          maxLength={4}
          placeholder="****"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          required
        />
      )}

      {staff && (
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="staff-active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <label htmlFor="staff-active" className="text-sm text-text">
            Active
          </label>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {staff ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

export default function StaffPage() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [resetPinStaff, setResetPinStaff] = useState<Staff | null>(null);
  const [newPin, setNewPin] = useState('');

  const { data: staffData, isLoading } = useStaffList();
  const { data: outletsData } = useOutlets();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff(editingStaff?.id || '');
  const deleteStaff = useDeleteStaff();
  const resetPin = useResetStaffPin();

  const staffList = staffData?.data || [];
  const outlets = outletsData?.data || [];

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingStaff(null);
  };

  const handleFormSubmit = (data: StaffFormData) => {
    if (editingStaff) {
      updateStaff.mutate(data, { onSuccess: closeForm });
    } else {
      createStaff.mutate(data, { onSuccess: closeForm });
    }
  };

  const handleResetPin = () => {
    if (!resetPinStaff || newPin.length !== 4) return;
    resetPin.mutate(
      { id: resetPinStaff.id, pin: newPin },
      {
        onSuccess: () => {
          setIsPinModalOpen(false);
          setResetPinStaff(null);
          setNewPin('');
        },
      }
    );
  };

  const handleDelete = (staff: Staff, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete staff member "${staff.name}"?`)) return;
    deleteStaff.mutate(staff.id);
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (staff: Staff) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {staff.name.split(' ').map((n) => n[0]).join('')}
          </div>
          <p className="font-medium text-text">{staff.name}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (staff: Staff) => (
        <span className="inline-flex items-center rounded-full bg-primary/5 px-2.5 py-0.5 text-xs font-medium capitalize text-primary">
          {staff.role}
        </span>
      ),
    },
    { key: 'outlet_name', header: 'Outlet' },
    {
      key: 'active',
      header: 'Status',
      render: (staff: Staff) => (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            staff.active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${staff.active ? 'bg-success' : 'bg-error'}`}
          />
          {staff.active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (staff: Staff) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingStaff(staff);
              setIsFormOpen(true);
            }}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setResetPinStaff(staff);
              setNewPin('');
              setIsPinModalOpen(true);
            }}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => handleDelete(staff, e)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-error"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Staff</h1>
          <p className="mt-1 text-sm text-text-muted">Manage staff accounts and access</p>
        </div>
        <Button
          onClick={() => {
            setEditingStaff(null);
            setIsFormOpen(true);
          }}
          disabled={outlets.length === 0}
        >
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          data={staffList}
          loading={isLoading}
          emptyMessage="No staff found"
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingStaff ? 'Edit Staff' : 'Add Staff'}
      >
        <StaffForm
          staff={editingStaff}
          outlets={outlets}
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          isSubmitting={createStaff.isPending || updateStaff.isPending}
        />
      </Modal>

      <Modal
        isOpen={isPinModalOpen}
        onClose={() => {
          setIsPinModalOpen(false);
          setResetPinStaff(null);
          setNewPin('');
        }}
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
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setIsPinModalOpen(false);
                setResetPinStaff(null);
                setNewPin('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleResetPin} disabled={resetPin.isPending || newPin.length !== 4}>
              Reset PIN
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}