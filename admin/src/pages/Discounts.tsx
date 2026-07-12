import { useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import {
  useDiscounts,
  useCreateDiscount,
  useUpdateDiscount,
  useDeleteDiscount,
  useToggleDiscount,
  useReorderDiscounts,
} from '@/hooks/useDiscounts';
import { useOutlets } from '@/hooks/useOutlets';
import { useCategories } from '@/hooks/useCategories';
import { useProducts } from '@/hooks/useProducts';
import type { Discount, DiscountFormData, DiscountScope, DiscountThresholdMode } from '@/types';

interface DiscountFormProps {
  discount: Discount | null;
  outlets: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; category_id?: string }>;
  onSubmit: (data: DiscountFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function DiscountForm({ discount, outlets, categories, products, onSubmit, onCancel, isSubmitting }: DiscountFormProps) {
  const [name, setName] = useState(discount?.name ?? '');
  const [kind, setKind] = useState<'percent' | 'fixed'>(discount?.kind ?? 'percent');
  const [amount, setAmount] = useState<string>(discount ? String(discount.amount) : '10');
  const [outletId, setOutletId] = useState<string | null>(discount?.outlet_id ?? null);
  const [isActive, setIsActive] = useState<boolean>(discount?.is_active ?? true);
  const [scope, setScope] = useState<DiscountScope>(discount?.scope ?? 'cart');
  const [minQuantity, setMinQuantity] = useState<string>(
    discount ? String(discount.min_quantity ?? 1) : '1',
  );
  const [thresholdMode, setThresholdMode] = useState<DiscountThresholdMode>(
    discount?.threshold_mode ?? 'gate',
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(discount?.target_category_ids ?? []);
  const [productIds, setProductIds] = useState<string[]>(discount?.target_product_ids ?? []);
  const [productFilter, setProductFilter] = useState('');

  const filteredProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, productFilter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsed = parseFloat(amount);
    const amt = Number.isFinite(parsed) ? parsed : 0;
    if (amt < 0) return;

    if (scope === 'targeted' && categoryIds.length === 0 && productIds.length === 0) {
      // A targeted rule needs at least one category or product to act on.
      return;
    }
    const minQ = Math.max(1, parseInt(minQuantity, 10) || 1);

    onSubmit({
      name: trimmed,
      kind,
      amount: amt,
      is_active: isActive,
      outlet_id: outletId,
      scope,
      min_quantity: scope === 'targeted' ? minQ : 1,
      threshold_mode: scope === 'targeted' ? thresholdMode : 'gate',
      target_category_ids: scope === 'targeted' ? categoryIds : [],
      target_product_ids: scope === 'targeted' ? productIds : [],
    });
  };

  const targetingInvalid =
    scope === 'targeted' && categoryIds.length === 0 && productIds.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Discount Name"
        placeholder="e.g. 10% Staff Discount"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text">Type</label>
        <div className="flex gap-3">
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="radio"
              name="kind"
              value="percent"
              checked={kind === 'percent'}
              onChange={() => setKind('percent')}
            />
            Percent
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="radio"
              name="kind"
              value="fixed"
              checked={kind === 'fixed'}
              onChange={() => setKind('fixed')}
            />
            Fixed Amount
          </label>
        </div>
      </div>

      <Input
        label={kind === 'percent' ? 'Percentage (%)' : 'Amount (SGD)'}
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text">Applies to</label>
        <div className="flex flex-wrap gap-3">
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="radio"
              name="scope"
              value="cart"
              checked={scope === 'cart'}
              onChange={() => setScope('cart')}
            />
            Whole cart
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <input
              type="radio"
              name="scope"
              value="targeted"
              checked={scope === 'targeted'}
              onChange={() => setScope('targeted')}
            />
            Specific products
          </label>
        </div>
        {scope === 'cart' && (
          <p className="mt-1.5 text-xs text-text-muted">
            Discounts the entire cart. Excludes any items already covered by a targeted rule.
          </p>
        )}
      </div>

      {scope === 'targeted' && (
        <div className="space-y-4 rounded-lg border border-gray-100 bg-surface/40 p-3">
          <Input
            label="Minimum quantity"
            type="number"
            min="1"
            step="1"
            value={minQuantity}
            onChange={(e) => setMinQuantity(e.target.value)}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text">When threshold is met</label>
            <div className="flex flex-col gap-2">
              <label className="inline-flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="threshold_mode"
                  value="gate"
                  checked={thresholdMode === 'gate'}
                  onChange={() => setThresholdMode('gate')}
                  className="mt-1"
                />
                <span>
                  <strong>Minimum quantity</strong> — once {minQuantity || 'N'}+ qualifying items are in the
                  cart, discount <em>all</em> of them.
                </span>
              </label>
              <label className="inline-flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="threshold_mode"
                  value="bundle"
                  checked={thresholdMode === 'bundle'}
                  onChange={() => setThresholdMode('bundle')}
                  className="mt-1"
                />
                <span>
                  <strong>Per bundle</strong> — discount every complete group of {minQuantity || 'N'};
                  the remainder stays full price.
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text">
              Categories {categoryIds.length > 0 && `(${categoryIds.length})`}
            </label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
              {categories.length === 0 && <p className="p-1 text-xs text-text-muted">No categories</p>}
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface/60">
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(c.id)}
                    onChange={() => setCategoryIds((prev) => toggleId(prev, c.id))}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text">
              Products {productIds.length > 0 && `(${productIds.length})`}
            </label>
            <input
              type="text"
              placeholder="Search products…"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="mb-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
              {filteredProducts.length === 0 && <p className="p-1 text-xs text-text-muted">No products</p>}
              {filteredProducts.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface/60">
                  <input
                    type="checkbox"
                    checked={productIds.includes(p.id)}
                    onChange={() => setProductIds((prev) => toggleId(prev, p.id))}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>

          {targetingInvalid && (
            <p className="text-xs text-error">Pick at least one category or product.</p>
          )}
        </div>
      )}

      {outlets.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">Outlet Scope (optional)</label>
          <select
            value={outletId ?? ''}
            onChange={(e) => setOutletId(e.target.value || null)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Active
      </label>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !name.trim() || targetingInvalid}>
          {discount ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

export default function Discounts() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);

  const { data: discountsData, isLoading } = useDiscounts();
  const { data: outletsData } = useOutlets();
  const { data: categoriesData } = useCategories();
  const { data: productsData } = useProducts();

  const createDiscount = useCreateDiscount();
  const updateDiscount = useUpdateDiscount();
  const deleteDiscount = useDeleteDiscount();
  const toggleDiscount = useToggleDiscount();
  const reorderDiscounts = useReorderDiscounts();

  const discounts = discountsData || [];
  const outlets = outletsData?.data || [];
  const categories = categoriesData?.data || [];
  const products = productsData?.data || [];

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingDiscount(null);
  };

  const handleFormSubmit = (data: DiscountFormData) => {
    if (editingDiscount) {
      updateDiscount.mutate({ id: editingDiscount.id, data }, { onSuccess: closeForm });
    } else {
      createDiscount.mutate(data, { onSuccess: closeForm });
    }
  };

  const handleEdit = (d: Discount) => {
    setEditingDiscount(d);
    setIsFormOpen(true);
  };

  const handleDelete = (d: Discount, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete discount "${d.name}"?`)) return;
    deleteDiscount.mutate(d.id);
  };

  const handleToggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleDiscount.mutate(id);
  };

  const moveDiscount = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= discounts.length) return;
    const newOrder = [...discounts];
    const tmp = newOrder[index];
    newOrder[index] = newOrder[target];
    newOrder[target] = tmp;
    const ids = newOrder.map((d) => d.id);
    reorderDiscounts.mutate(ids);
  };

  const getOutletName = (id: string | null) => {
    if (!id) return null;
    return outlets.find((o: any) => o.id === id)?.name ?? null;
  };

  const formatAmount = (d: Discount) => {
    if (d.kind === 'percent') {
      return `${d.amount}%`;
    }
    return `S$${Number(d.amount).toFixed(2)}`;
  };

  const describeScope = (d: Discount): string => {
    if (d.scope !== 'targeted') return 'Whole cart';
    const parts: string[] = [];
    if (d.target_category_ids.length) parts.push(`${d.target_category_ids.length} cat.`);
    if (d.target_product_ids.length) parts.push(`${d.target_product_ids.length} prod.`);
    const target = parts.join(' + ') || 'targeted';
    const rule =
      d.threshold_mode === 'bundle'
        ? `every ${d.min_quantity}`
        : d.min_quantity > 1
          ? `min ${d.min_quantity}`
          : 'any qty';
    return `${target} · ${rule}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Discounts</h1>
          <p className="mt-1 text-sm text-text-muted">Manage staff discounts and promotions</p>
        </div>
        <Button onClick={() => { setEditingDiscount(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add Discount
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wider text-text-muted">
                <th className="w-12 px-3 py-3" aria-label="Reorder" />
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Applies to</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Outlet</th>
                <th className="w-20 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">Loading…</td>
                </tr>
              )}
              {!isLoading && discounts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-muted">No discounts yet</td>
                </tr>
              )}
              {discounts.map((d, index) => (
                <tr
                  key={d.id}
                  className="border-b border-gray-50 hover:bg-surface/40 cursor-pointer"
                  onClick={() => handleEdit(d)}
                >
                  <td className="px-2 py-3">
                    <div className="flex flex-col">
                      <button
                        onClick={(e) => { e.stopPropagation(); moveDiscount(index, -1); }}
                        disabled={index === 0}
                        className="rounded p-0.5 text-text-muted hover:text-text disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveDiscount(index, 1); }}
                        disabled={index === discounts.length - 1}
                        className="rounded p-0.5 text-text-muted hover:text-text disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-text">{d.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${d.kind === 'percent' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700'}`}>
                      {d.kind === 'percent' ? 'Percent' : 'Fixed'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatAmount(d)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs ${d.scope === 'targeted' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-text-muted'}`}
                    >
                      {describeScope(d)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => handleToggle(d.id, e)}
                      className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${d.is_active ? 'bg-primary' : 'bg-gray-200'}`}
                      aria-label={d.is_active ? 'Deactivate' : 'Activate'}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${d.is_active ? 'translate-x-5' : 'translate-x-0.5'}`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {d.outlet_id ? getOutletName(d.outlet_id) || '—' : 'All outlets'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEdit(d); }}
                        className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white hover:text-text"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(d, e)}
                        className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white hover:text-error"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingDiscount ? 'Edit Discount' : 'Add Discount'}
      >
        <DiscountForm
          discount={editingDiscount}
          outlets={outlets}
          categories={categories}
          products={products}
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          isSubmitting={createDiscount.isPending || updateDiscount.isPending}
        />
      </Modal>
    </div>
  );
}
