import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import type { Product, Category, ModifierGroup } from '@/types';

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  description: z.string().min(1, 'Description is required'),
  price: z.coerce.number().positive('Price must be positive'),
  category_id: z.string().min(1, 'Category is required'),
  available: z.boolean(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormProps {
  product?: Product | null;
  categories: Category[];
  onSubmit: (data: ProductFormValues) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ProductForm({
  product,
  categories,
  onSubmit,
  onCancel,
  loading = false,
}: ProductFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      price: product?.price || 0,
      category_id: product?.category_id || '',
      available: product?.available ?? true,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Input
        label="Product Name"
        placeholder="e.g. Classic Gelato"
        error={errors.name?.message}
        {...register('name')}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text">Description</label>
        <textarea
          className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          rows={3}
          placeholder="Describe the product..."
          {...register('description')}
        />
        {errors.description && (
          <span className="text-xs text-error">{errors.description.message}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Price ($)"
          type="number"
          step="0.01"
          placeholder="0.00"
          error={errors.price?.message}
          {...register('price')}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Category</label>
          <select
            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            {...register('category_id')}
          >
            <option value="">Select category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          {errors.category_id && (
            <span className="text-xs text-error">{errors.category_id.message}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="available"
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          {...register('available')}
        />
        <label htmlFor="available" className="text-sm text-text">
          Available for sale
        </label>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          {product ? 'Update Product' : 'Create Product'}
        </Button>
      </div>
    </form>
  );
}