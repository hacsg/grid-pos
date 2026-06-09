import { useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ProductTable from '@/components/products/ProductTable';
import ProductForm from '@/components/products/ProductForm';
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, useDeleteProducts, useToggleProductAvailability, useToggleProductsAvailability } from '@/hooks/useProducts';
import { useCategories } from '@/hooks/useCategories';
import { useSaveProductModifierAssignments } from '@/hooks/useModifiers';
import type { Product, ProductModifierAssignment } from '@/types';

export default function Products() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const { data: productsData, isLoading } = useProducts({
    search: search || undefined,
    category_id: categoryFilter || undefined,
  });
  const { data: categoriesData } = useCategories();

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct(editingProduct?.id || '');
  const deleteProduct = useDeleteProduct();
  const deleteProducts = useDeleteProducts();
  const toggleAvailability = useToggleProductAvailability();
  const toggleBulkAvailability = useToggleProductsAvailability();
  const saveModifierAssignments = useSaveProductModifierAssignments();

  const products = productsData?.data || [];
  const categories = categoriesData?.data || [];

  const handleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === products.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(products.map((p) => p.id));
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
  };

  const handleFormSubmit = async (data: any, assignments: ProductModifierAssignment[]) => {
    const productBeingEdited = editingProduct;

    try {
      if (productBeingEdited) {
        await updateProduct.mutateAsync(data);
        await saveModifierAssignments.mutateAsync({
          productId: productBeingEdited.id,
          originalAssignments: productBeingEdited.modifier_groups || [],
          assignments,
        });
        closeForm();
      } else {
        await createProduct.mutateAsync(data);
        closeForm();
      }
    } catch {
      // API errors are surfaced by the shared client interceptor.
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    deleteProducts.mutate(selectedIds, {
      onSuccess: () => setSelectedIds([]),
    });
  };

  const handleBulkToggle = (available: boolean) => {
    if (selectedIds.length === 0) return;
    toggleBulkAvailability.mutate({ ids: selectedIds, available });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Products</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage your product catalog
          </p>
        </div>
        <Button onClick={() => { setEditingProduct(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-primary">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleBulkToggle(true)}
            >
              <ToggleRight className="h-4 w-4" />
              Set Available
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleBulkToggle(false)}
            >
              <ToggleLeft className="h-4 w-4" />
              Set Unavailable
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      )}

      <Card>
        <ProductTable
          products={products}
          categories={categories}
          loading={isLoading}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
          onEdit={handleEdit}
          onToggleAvailability={(id) => toggleAvailability.mutate(id)}
          onSearch={setSearch}
          onFilterCategory={setCategoryFilter}
        />
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingProduct ? 'Edit Product' : 'Create Product'}
        size="lg"
      >
        <ProductForm
          key={editingProduct?.id || 'new'}
          product={editingProduct}
          categories={categories}
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          loading={createProduct.isPending || updateProduct.isPending || saveModifierAssignments.isPending}
        />
      </Modal>
    </div>
  );
}
