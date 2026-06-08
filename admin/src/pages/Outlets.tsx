import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import {
  useOutlets,
  useCreateOutlet,
  useUpdateOutlet,
  useDeleteOutlet,
} from '@/hooks/useOutlets';
import type { Outlet, OutletFormData } from '@/types';

interface OutletFormProps {
  outlet: Outlet | null;
  onSubmit: (data: OutletFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function OutletForm({ outlet, onSubmit, onCancel, isSubmitting }: OutletFormProps) {
  const [name, setName] = useState(outlet?.name ?? '');
  const [address, setAddress] = useState(outlet?.address ?? '');
  const [phone, setPhone] = useState(outlet?.phone ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    onSubmit({
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim() || null,
    });
  };

  return (
    <form key={outlet?.id ?? 'new'} onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Outlet Name"
        placeholder="e.g. HAC Bedok"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Input
        label="Address"
        placeholder="123 Main St"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        required
      />
      <Input
        label="Phone"
        placeholder="555-0100"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {outlet ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

export default function Outlets() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);

  const { data: outletsData, isLoading } = useOutlets();
  const createOutlet = useCreateOutlet();
  const updateOutlet = useUpdateOutlet(editingOutlet?.id || '');
  const deleteOutlet = useDeleteOutlet();

  const outlets = outletsData?.data || [];

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingOutlet(null);
  };

  const handleFormSubmit = (data: OutletFormData) => {
    if (editingOutlet) {
      updateOutlet.mutate(data, { onSuccess: closeForm });
    } else {
      createOutlet.mutate(data, { onSuccess: closeForm });
    }
  };

  const handleDelete = (outlet: Outlet, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete outlet "${outlet.name}"?`)) return;
    deleteOutlet.mutate(outlet.id);
  };

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
    {
      key: 'phone',
      header: 'Phone',
      render: (outlet: Outlet) => outlet.phone || '—',
    },
    {
      key: 'actions',
      header: '',
      width: '60px',
      render: (outlet: Outlet) => (
        <button
          onClick={(e) => handleDelete(outlet, e)}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-error"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const handleEdit = (outlet: Outlet) => {
    setEditingOutlet(outlet);
    setIsFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Outlets</h1>
          <p className="mt-1 text-sm text-text-muted">Manage store locations</p>
        </div>
        <Button onClick={() => { setEditingOutlet(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add Outlet
        </Button>
      </div>

      <Card>
        <Table
          columns={columns}
          data={outlets}
          loading={isLoading}
          onRowClick={handleEdit}
          emptyMessage="No outlets found"
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingOutlet ? 'Edit Outlet' : 'Add Outlet'}
      >
        <OutletForm
          outlet={editingOutlet}
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          isSubmitting={createOutlet.isPending || updateOutlet.isPending}
        />
      </Modal>
    </div>
  );
}