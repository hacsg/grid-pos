import { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import Table from '@/components/ui/Table';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import type { Product, Category } from '@/types';

interface ProductTableProps {
  products: Product[];
  categories: Category[];
  loading: boolean;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onEdit: (product: Product) => void;
  onToggleAvailability: (id: string, isAvailable: boolean) => void;
  onSearch: (query: string) => void;
  onFilterCategory: (categoryId: string) => void;
}

export default function ProductTable({
  products,
  categories,
  loading,
  selectedIds,
  onSelect,
  onSelectAll,
  onEdit,
  onToggleAvailability,
  onSearch,
  onFilterCategory,
}: ProductTableProps) {
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const handleSearch = (value: string) => {
    setSearchInput(value);
    onSearch(value);
  };

  const handleCategoryFilter = (value: string) => {
    setCategoryFilter(value);
    onFilterCategory(value);
  };

  const columns = [
    {
      key: 'name',
      header: 'Product',
      render: (product: Product) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/5 text-xs font-semibold text-primary">
            {product.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-text">{product.name}</p>
              {product.is_gift_card && (
                <span className="inline-flex items-center rounded-full bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Gift Card
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted line-clamp-1">{product.description}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'category_name',
      header: 'Category',
      render: (product: Product) => (
        <span className="inline-flex items-center rounded-full bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary">
          {product.category_name}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (product: Product) => (
        <span className="font-medium text-text">${product.price.toFixed(2)}</span>
      ),
    },
    {
      key: 'available',
      header: 'Status',
      render: (product: Product) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleAvailability(product.id, !product.available);
          }}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
            product.available
              ? 'bg-success/10 text-success'
              : 'bg-error/10 text-error'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${product.available ? 'bg-success' : 'bg-error'}`} />
          {product.available ? 'Available' : 'Unavailable'}
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-text placeholder:text-text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <select
            value={categoryFilter}
            onChange={(e) => handleCategoryFilter(e.target.value)}
            className="w-48 rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Table
        columns={columns}
        data={products}
        loading={loading}
        onRowClick={onEdit}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onSelectAll={onSelectAll}
        selectable
        emptyMessage="No products found"
      />
    </div>
  );
}