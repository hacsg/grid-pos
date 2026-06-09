import { useEffect, useMemo, useState } from 'react';
import { Check, LogOut, Package, Search, X } from 'lucide-react';
import type { Category, Modifier, ModifierGroup, Product } from '@/api/client';
import { formatCurrency, money } from '@/api/client';
import type { CartModifier } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface ProductGridProps {
  categories: Category[];
  products: Product[];
  selectedCategoryId: string;
  search: string;
  outletName: string;
  staffName: string;
  isLoading: boolean;
  onCategoryChange: (categoryId: string) => void;
  onSearchChange: (search: string) => void;
  onAddProduct: (product: Product, modifiers?: CartModifier[]) => void;
  onLogout: () => void;
}

type SelectionMap = Record<string, string[]>;

function productStock(product: Product): { label: string; state: 'in' | 'low' | 'out' } {
  const stock = product.stock_quantity ?? product.stock ?? product.inventory_count;
  if (!product.is_available || stock === 0) {
    return { label: 'Out', state: 'out' };
  }
  if (typeof stock === 'number' && stock <= 5) {
    return { label: `Low ${stock}`, state: 'low' };
  }
  return { label: 'In stock', state: 'in' };
}

function hasModifiers(product: Product): boolean {
  return product.modifier_groups?.some((group) => group.modifiers?.length > 0) ?? false;
}

function modifierPrice(modifier: Modifier): string {
  const price = money(modifier.price_adjustment);
  if (price === 0) {
    return '';
  }
  return `+${formatCurrency(price)}`;
}

function requiredMinimum(group: ModifierGroup): number {
  return group.required ? Math.max(group.min_select, 1) : group.min_select;
}

export default function ProductGrid({
  categories,
  products,
  selectedCategoryId,
  search,
  outletName,
  staffName,
  isLoading,
  onCategoryChange,
  onSearchChange,
  onAddProduct,
  onLogout,
}: ProductGridProps) {
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [selections, setSelections] = useState<SelectionMap>({});
  const [error, setError] = useState('');

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [categories]
  );

  useEffect(() => {
    if (!modifierProduct) {
      return;
    }
    const initial: SelectionMap = {};
    modifierProduct.modifier_groups.forEach((group) => {
      initial[group.id] = [];
    });
    setSelections(initial);
    setError('');
  }, [modifierProduct]);

  function handleProductTap(product: Product) {
    tapFeedback();
    if (!product.is_available) {
      return;
    }
    if (hasModifiers(product)) {
      setModifierProduct(product);
      return;
    }
    onAddProduct(product);
  }

  function toggleModifier(group: ModifierGroup, modifierId: string) {
    tapFeedback();
    setSelections((current) => {
      const existing = current[group.id] ?? [];
      if (group.max_select === 1) {
        return { ...current, [group.id]: existing.includes(modifierId) ? [] : [modifierId] };
      }
      if (existing.includes(modifierId)) {
        return { ...current, [group.id]: existing.filter((id) => id !== modifierId) };
      }
      if (existing.length >= group.max_select) {
        return current;
      }
      return { ...current, [group.id]: [...existing, modifierId] };
    });
  }

  function validateModifierSelection(product: Product): boolean {
    for (const group of product.modifier_groups) {
      const selectedCount = selections[group.id]?.length ?? 0;
      const minimum = requiredMinimum(group);
      if (selectedCount < minimum) {
        setError(`${group.name} requires ${minimum} selection${minimum === 1 ? '' : 's'}`);
        return false;
      }
      if (selectedCount > group.max_select) {
        setError(`${group.name} allows up to ${group.max_select} selection${group.max_select === 1 ? '' : 's'}`);
        return false;
      }
    }
    setError('');
    return true;
  }

  function confirmModifiers() {
    if (!modifierProduct || !validateModifierSelection(modifierProduct)) {
      return;
    }
    const selectedModifiers = modifierProduct.modifier_groups.flatMap((group) => {
      const selectedIds = selections[group.id] ?? [];
      return group.modifiers
        .filter((modifier) => selectedIds.includes(modifier.id))
        .map<CartModifier>((modifier) => ({
          id: `${group.id}:${modifier.id}`,
          modifier_name: `${group.name}: ${modifier.name}`,
          price_adjustment: money(modifier.price_adjustment),
        }));
    });
    onAddProduct(modifierProduct, selectedModifiers);
    setModifierProduct(null);
  }

  return (
    <section className="product-stage" aria-label="Products">
      <header className="pos-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <h1>Grid POS</h1>
            <p>{outletName} - {staffName}</p>
          </div>
        </div>
        <button className="icon-text-button subtle" type="button" onPointerDown={() => tapFeedback()} onClick={onLogout}>
          <LogOut size={18} aria-hidden="true" />
          Sign out
        </button>
      </header>

      <div className="catalog-toolbar">
        <label className="search-field">
          <Search size={20} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search products"
            type="search"
          />
        </label>
      </div>

      <nav className="category-tabs" aria-label="Categories">
        <button
          className={selectedCategoryId === 'all' ? 'active' : ''}
          type="button"
          onPointerDown={() => tapFeedback()}
          onClick={() => onCategoryChange('all')}
        >
          All
        </button>
        {sortedCategories.map((category) => (
          <button
            key={category.id}
            className={selectedCategoryId === category.id ? 'active' : ''}
            type="button"
            onPointerDown={() => tapFeedback()}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.name}
          </button>
        ))}
      </nav>

      <div className="product-grid" aria-busy={isLoading}>
        {isLoading &&
          Array.from({ length: 8 }).map((_, index) => (
            <div className="product-card skeleton" key={index} />
          ))}

        {!isLoading && products.length === 0 && (
          <div className="empty-state">
            <Package size={28} aria-hidden="true" />
            <span>No products found</span>
          </div>
        )}

        {!isLoading &&
          products.map((product) => {
            const stock = productStock(product);
            return (
              <button
                key={product.id}
                className="product-card"
                type="button"
                disabled={!product.is_available || stock.state === 'out'}
                onClick={() => handleProductTap(product)}
              >
                <div className="product-image">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" loading="lazy" />
                  ) : (
                    <span>{product.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="product-copy">
                  <div>
                    <h2>{product.name}</h2>
                    <p>{product.category?.name ?? 'Uncategorised'}</p>
                  </div>
                  <div className="product-meta">
                    <strong>{formatCurrency(product.price)}</strong>
                    <span className={`stock-pill ${stock.state}`}>{stock.label}</span>
                  </div>
                </div>
              </button>
            );
          })}
      </div>

      {modifierProduct && (
        <div className="modal-backdrop" role="presentation">
          <section className="modifier-sheet" role="dialog" aria-modal="true" aria-labelledby="modifier-title">
            <header className="sheet-header">
              <div>
                <p>Modifiers</p>
                <h2 id="modifier-title">{modifierProduct.name}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close modifiers"
                title="Close"
                onPointerDown={() => tapFeedback()}
                onClick={() => setModifierProduct(null)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="modifier-body">
              {modifierProduct.modifier_groups.map((group) => {
                const selected = selections[group.id] ?? [];
                return (
                  <fieldset className="modifier-group" key={group.id}>
                    <legend>
                      <span className="modifier-group-title">{group.name}</span>
                      <span className="modifier-count">{selected.length}/{group.max_select}</span>
                    </legend>
                    <div className="modifier-options">
                      {group.modifiers.map((modifier) => {
                        const checked = selected.includes(modifier.id);
                        const priceLabel = modifierPrice(modifier);
                        return (
                          <button
                            type="button"
                            key={modifier.id}
                            className={`modifier-option ${checked ? 'selected' : ''}`}
                            onPointerDown={() => tapFeedback()}
                            onClick={() => toggleModifier(group, modifier.id)}
                          >
                            <span className="modifier-name">{modifier.name}</span>
                            {priceLabel && <span className="modifier-price">{priceLabel}</span>}
                            {checked && <Check className="modifier-check" size={20} aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>

            {error && <p className="form-error">{error}</p>}

            <footer className="sheet-actions">
              <button className="secondary-button" type="button" onClick={() => setModifierProduct(null)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmModifiers}>
                Add item
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
