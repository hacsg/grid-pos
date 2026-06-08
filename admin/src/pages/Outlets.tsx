import { useState } from 'react';
import { Plus } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { useOutlets, useCreateOutlet, useUpdateOutlet } from '@/hooks/useOutlets';
import type { Outlet, OutletFormData } from '@/types';

export default function Outlets() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [active, setActive] = useState(true);

  const { data: outletsData, isLoading } = useOutlets();
  const createOutlet = useCreateOutlet();
  const updateOutlet = useUpdateOutlet(editingOutlet?.id || '');

  const outlets = outletsData?.data || [];

  const columns = [
    {
      key: 'name',
      header: 'Outlet',
      render: (outlet: Outlet) => (
        <div>
          <p className="font-medium text-text">{outlet.name}</p>
          <p className="text-xs text-text-muted">{outlet.address}</p>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email' },
    {
      key: 'active',
      header: 'Status',
      render: (outlet: Outlet) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          outlet.active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${outlet.active ? 'bg-success' : 'bg-error'}`} />
          {outlet.active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
  ];

  function openCreate() {
    setEditingOutlet(null);
    setName('');
    setAddress('');
    setPhone('');
    setEmail('');
    setActive(true);
    setIsFormOpen(true);
  }

  function handleEdit(outlet: Outlet) {
    setEditingOutlet(outlet);
    setName(outlet.name || '');
    setAddress(outlet.address || '');
    setPhone(outlet.phone || '');
    setEmail(outlet.email || '');
    setActive(outlet.active ?? true);
    setIsFormOpen(true);
  }

  function closeModal() {
    setIsFormOpen(false);
    setEditingOutlet(null);
  }

  async function handleSubmit() {
    if (!name.trim() || !address.trim()) {
      return;
    }
    const payload: OutletFormData = {
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      active,
    };
    if (editingOutlet) {
      updateOutlet.mutate(payload, {
        onSuccess: () => closeModal(),
      });
    } else {
      createOutlet.mutate(payload, {
        onSuccess: () => closeModal(),
      });
    }
  }

  const isSubmitting = createOutlet.isPending || updateOutlet.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Outlets</h1>
          <p className="mt-1 text-sm text-text-muted">Manage store locations</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Add Outlet
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          data={outlets as any}
          loading={isLoading}
          onRowClick={handleEdit}
          emptyMessage="No outlets found"
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeModal}
        title={editingOutlet ? 'Edit Outlet' : 'Add Outlet'}
      >
        <div className="space-y-4">
          <Input
            label="Outlet Name"
            placeholder="e.g. HAC Sunset Way"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Address"
            placeholder="Sunset Way, Singapore"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Input
            label="Phone"
            placeholder="Optional"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            placeholder="Optional"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="outlet-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="outlet-active" className="text-sm text-text">Active</label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={closeModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={isSubmitting} disabled={!name.trim() || !address.trim()}>
              {editingOutlet ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}