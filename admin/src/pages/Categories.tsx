import { useQueryClient } from '@tanstack/react-query';
import { useCategories as useCategoriesQuery, useCreateCategory, useDeleteCategory, useReorderCategories } from '@/hooks/useCategories';
import { updateCategory as updateCategoryApi } from '@/api/client';
import { useOutlets } from '@/hooks/useOutlets';
import Card from '@/components/ui/Card';
import CategoryManager from '@/components/products/CategoryManager';

export default function Categories() {
  const queryClient = useQueryClient();
  const { data: categoriesData, isLoading: catLoading } = useCategoriesQuery();
  const { data: outletsData, isLoading: outletsLoading } = useOutlets();

  const categories = categoriesData?.data || [];
  const outlets = outletsData?.data || [];

  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const reorderCategory = useReorderCategories();

  const handleCreate = (data: { name: string; outlet_ids: string[] }) => {
    createCategory.mutate({ name: data.name, outlet_ids: data.outlet_ids });
  };

  const handleUpdate = (id: string, data: { name: string; outlet_ids: string[] }) => {
    updateCategoryApi(id, { name: data.name, outlet_ids: data.outlet_ids }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    });
  };

  const handleDelete = (id: string) => {
    deleteCategory.mutate(id);
  };

  const handleReorder = (ids: string[]) => {
    reorderCategory.mutate(ids);
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
          outlets={outlets as any}
          loading={catLoading || outletsLoading}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onReorder={handleReorder}
        />
      </div>
    </div>
  );
}