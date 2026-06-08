import { useState } from 'react';
import { Plus, KeyRound } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import type { Staff, StaffRole } from '@/types';

const mockStaff: Staff[] = [
  { id: '1', name: 'Alice Johnson', email: 'alice@gridpos.com', role: 'manager', pin: '1234', outlet_id: '1', outlet_name: 'Main Street', active: true, created_at: '2024-01-01' },
  { id: '2', name: 'Bob Smith', email: 'bob@gridpos.com', role: 'cashier', pin: '5678', outlet_id: '1', outlet_name: 'Main Street', active: true, created_at: '2024-01-01' },
  { id: '3', name: 'Carol Davis', email: 'carol@gridpos.com', role: 'kitchen', pin: '9012', outlet_id: '2', outlet_name: 'Downtown', active: true, created_at: '2024-01-01' },
];

export default function Staff() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [resetPinStaff, setResetPinStaff] = useState<Staff | null>(null);
  const [newPin, setNewPin] = useState('');

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (staff: Staff) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {staff.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <p className="font-medium text-text">{staff.name}</p>
            <p className="text-xs text-text-muted">{staff.email}</p>
          </div>
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
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          staff.active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${staff.active ? 'bg-success' : 'bg-error'}`} />
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
            onClick={(e) => { e.stopPropagation(); setEditingStaff(staff); setIsFormOpen(true); }}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setResetPinStaff(staff); setNewPin(''); setIsPinModalOpen(true); }}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <KeyRound className="h-4 w-4" />
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
        <Button onClick={() => { setEditingStaff(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          data={mockStaff}
          emptyMessage="No staff found"
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingStaff(null); }}
        title={editingStaff ? 'Edit Staff' : 'Add Staff'}
      >
        <div className="space-y-4">
          <Input label="Full Name" placeholder="e.g. Jane Doe" defaultValue={editingStaff?.name} />
          <Input label="Email" type="email" placeholder="jane@gridpos.com" defaultValue={editingStaff?.email} />
          
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Role</label>
            <select className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              <option value="kitchen">Kitchen</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">Outlet</label>
            <select className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="1">Main Street</option>
              <option value="2">Downtown</option>
            </select>
          </div>

          {!editingStaff && <Input label="PIN (4 digits)" type="password" maxLength={4} placeholder="****" />}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setIsFormOpen(false); setEditingStaff(null); }}>Cancel</Button>
            <Button>{editingStaff ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
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
            onChange={(e) => setNewPin(e.target.value)}
          />
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setIsPinModalOpen(false)}>Cancel</Button>
            <Button>Reset PIN</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}