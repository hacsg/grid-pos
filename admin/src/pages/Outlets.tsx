import { useState } from 'react';
import { Plus } from 'lucide-react';
import Card from '@/components/ui/Card';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import type { Outlet } from '@/types';

const mockOutlets: Outlet[] = [
  { id: '1', name: 'Main Street', address: '123 Main St, Downtown', phone: '555-0100', email: 'main@gridpos.com', active: true, created_at: '2024-01-01' },
  { id: '2', name: 'Downtown', address: '456 Oak Ave, City Center', phone: '555-0101', email: 'downtown@gridpos.com', active: true, created_at: '2024-01-01' },
];

export default function Outlets() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null);

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
          data={mockOutlets}
          onRowClick={handleEdit}
          emptyMessage="No outlets found"
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingOutlet(null); }}
        title={editingOutlet ? 'Edit Outlet' : 'Add Outlet'}
      >
        <div className="space-y-4">
          <Input label="Outlet Name" placeholder="e.g. Main Street" defaultValue={editingOutlet?.name} />
          <Input label="Address" placeholder="123 Main St" defaultValue={editingOutlet?.address} />
          <Input label="Phone" placeholder="555-0100" defaultValue={editingOutlet?.phone} />
          <Input label="Email" type="email" placeholder="outlet@gridpos.com" defaultValue={editingOutlet?.email} />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="outlet-active"
              defaultChecked={editingOutlet?.active ?? true}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="outlet-active" className="text-sm text-text">Active</label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setIsFormOpen(false); setEditingOutlet(null); }}>Cancel</Button>
            <Button>{editingOutlet ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}