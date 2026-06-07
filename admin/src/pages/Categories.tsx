import { useCategories as useCategoriesQuery } from '@/hooks/useCategories';
import Card from '@/components/ui/Card';
import CategoryManager from '@/components/products/CategoryManager';
import type { Outlet } from '@/types';

const mockOutlets: Outlet[] = [
  { id: '1', name: 'Main Street', address: '123 Main St', phone: '555-0100', email: 'main@gridpos.com', active: true, created_at: '2024-01-01' },
  { id: '2', name: 'Downtown', address: '456 Oak Ave', phone: '555-0101', email: 'downtown@gridpos.com', active: true, created_at: '2024-01-01' },
];

export default function Categories() {
  const { data: categoriesData, isLoading } = useCategoriesQuery();
  const categories = categoriesData?.data || [];

  const handleCreate = (data: { name: string; outlet_ids: string[] }) => {
    console.log('Create category:', data);
  };

  const handleUpdate = (id: string, data: { name: string; outlet_ids: string[] }) => {
    console.log('Update category:', id, data);
  };

  const handleDelete = (id: string) => {
    console.log('Delete category:', id);
  };

  const handleReorder = (ids: string[]) => {
    console.log('Reorder categories:', ids);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Categories</h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage product categories and outlet assignments
        </p>
      </div>

      <div className="max-w-2xl">
        <CategoryManager
          categories={categories}
          outlets={mockOutlets}
          loading={isLoading}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onReorder={handleReorder}
        />
      </div>
    </div>
  );
}