import { useState } from 'react';
import { Image as ImageIcon, Plus, Trash2, Upload, XCircle } from 'lucide-react';
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
  useUploadPayNowQr,
  useDeletePayNowQr,
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

function PayNowQrControls({ outlet }: { outlet: Outlet }) {
  const uploadQr = useUploadPayNowQr();
  const deleteQr = useDeletePayNowQr();
  const isBusy = uploadQr.isPending || deleteQr.isPending;

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    uploadQr.mutate({ outletId: outlet.id, file });
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`Remove manual PayNow QR for "${outlet.name}"?`)) return;
    deleteQr.mutate(outlet.id);
  };

  return (
    <div className="flex items-center gap-3" onClick={(event) => event.stopPropagation()}>
      <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-lg border border-gray-200 bg-surface">
        {outlet.paynow_qr_url ? (
          <img src={outlet.paynow_qr_url} alt={`${outlet.name} PayNow QR`} className="h-full w-full object-contain" />
        ) : (
          <ImageIcon className="h-5 w-5 text-text-muted" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface ${
            isBusy ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <Upload className="h-3.5 w-3.5" />
          {outlet.paynow_qr_url ? 'Replace' : 'Upload'}
          <input
            className="hidden"
            type="file"
            accept="image/png,image/jpeg"
            disabled={isBusy}
            onChange={handleUpload}
          />
        </label>
        {outlet.paynow_qr_url && (
          <button
            type="button"
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-error disabled:opacity-50"
            disabled={isBusy}
            onClick={handleDelete}
            aria-label={`Remove ${outlet.name} PayNow QR`}
            title="Remove QR"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
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
      key: 'paynow_qr',
      header: 'Manual PayNow',
      render: (outlet: Outlet) => <PayNowQrControls outlet={outlet} />,
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
