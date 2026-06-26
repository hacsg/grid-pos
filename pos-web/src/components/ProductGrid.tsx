import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, LogOut, Package, Search, X } from 'lucide-react';
import type { Category, Modifier, ModifierGroup, Product } from '@/api/client';
import { formatCurrency, money } from '@/api/client';
import type { CartModifier } from '@/types';
import { tapFeedback } from '@/utils/haptics';

interface EditItem {
  lineId: string;
  product: Product;
  modifiers: CartModifier[];
}

interface ProductGridProps {
  categories: Category[];
  products: Product[];
  selectedCategoryId: string;
  search: string;
  outletName: string;
  staffName: string;
  isLoading: boolean;
  editItem: EditItem | null;
  onCategoryChange: (categoryId: string) => void;
  onSearchChange: (search: string) => void;
  onSearchSubmit: (search: string) => void;
  onScanSuccess: () => void;
  onAddProduct: (product: Product, modifiers?: CartModifier[]) => void;
  onEditProduct: (lineId: string, modifiers: CartModifier[]) => void;
  onEditDismiss: () => void;
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

function productScanTokens(product: Product): string[] {
  const source = product as Product & Record<string, unknown>;
  return ['sku', 'barcode', 'bar_code', 'product_code', 'code', 'upc', 'ean']
    .map((key) => source[key])
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

function requiredMinimum(group: ModifierGroup): number {
  return group.required ? Math.max(group.min_select, 1) : 0;
}

export default function ProductGrid({
  categories,
  products,
  selectedCategoryId,
  search,
  outletName,
  staffName,
  isLoading,
  editItem,
  onCategoryChange,
  onSearchChange,
  onSearchSubmit,
  onScanSuccess,
  onAddProduct,
  onEditProduct,
  onEditDismiss,
  onLogout,
}: ProductGridProps) {
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [selections, setSelections] = useState<SelectionMap>({});
  const [error, setError] = useState('');
  const [scanSuccess, setScanSuccess] = useState(false);
  const scanSuccessTimer = useRef<number | null>(null);

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
    if (editItem && editItem.product.id === modifierProduct.id) {
      editItem.modifiers.forEach((modifier) => {
        const [groupId, modifierId] = modifier.id.split(':');
        if (groupId && modifierId && initial[groupId]) {
          initial[groupId].push(modifierId);
        }
      });
    }
    setSelections(initial);
    setError('');
  }, [modifierProduct, editItem]);

  useEffect(() => {
    if (editItem) {
      setModifierProduct(editItem.product);
    }
  }, [editItem]);

  useEffect(() => {
    return () => {
      if (scanSuccessTimer.current !== null) {
        window.clearTimeout(scanSuccessTimer.current);
      }
    };
  }, []);

  const isEditing = Boolean(editItem && modifierProduct && editItem.product.id === modifierProduct.id);

  function closeModifierSheet() {
    setModifierProduct(null);
    if (editItem) {
      onEditDismiss();
    }
  }

  function handleProductTap(product: Product): boolean {
    tapFeedback();
    if (!product.is_available) {
      return false;
    }
    if (hasModifiers(product)) {
      setModifierProduct(product);
      return false;
    }
    onAddProduct(product);
    return true;
  }

  function showScanSuccess() {
    setScanSuccess(true);
    if (scanSuccessTimer.current !== null) {
      window.clearTimeout(scanSuccessTimer.current);
    }
    scanSuccessTimer.current = window.setTimeout(() => {
      setScanSuccess(false);
      scanSuccessTimer.current = null;
    }, 900);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return;
    }
    const submitted = search.trim();
    if (!submitted) {
      return;
    }
    const normalized = submitted.toLowerCase();
    const exactMatch = availableProducts.find((product) =>
      productScanTokens(product).includes(normalized)
    );
    event.preventDefault();
    onSearchSubmit(submitted);
    if (!exactMatch) {
      return;
    }
    const added = handleProductTap(exactMatch);
    if (added) {
      onSearchChange('');
      onScanSuccess();
      showScanSuccess();
    }
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
    if (isEditing && editItem) {
      onEditProduct(editItem.lineId, selectedModifiers);
    } else {
      onAddProduct(modifierProduct, selectedModifiers);
    }
    closeModifierSheet();
  }

  const availableProducts = useMemo(
    () => products.filter((product) => product.is_available),
    [products]
  );

  return (
    <section className="product-stage" aria-label="Products">
      <header className="pos-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">G</div>
          <div>
            <h1>Grid POS</h1>
            <p>{outletName} – {staffName}</p>
          </div>
        </div>
        <button
          className="icon-text-button subtle"
          type="button"
          aria-label="Sign out"
          onPointerDown={() => tapFeedback()}
          onClick={onLogout}
        >
          <LogOut size={18} aria-hidden="true" />
          Sign out
        </button>
      </header>

      <div className="catalog-toolbar">
        <label className={`search-field ${scanSuccess ? 'scan-success' : ''}`}>
          <Search size={20} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search products"
            type="search"
          />
          {scanSuccess && (
            <span className="search-scan-status" aria-live="polite">
              <Check size={15} aria-hidden="true" />
              Added
            </span>
          )}
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
        {sortedCategories.map((category) => {
          const isActive = selectedCategoryId === category.id;
          const tabColor = category.color ?? undefined;
          return (
            <button
              key={category.id}
              className={isActive ? 'active' : ''}
              type="button"
              style={tabColor ? ({ '--tab-color': tabColor } as React.CSSProperties) : undefined}
              onPointerDown={() => tapFeedback()}
              onClick={() => onCategoryChange(category.id)}
            >
              {!isActive && tabColor && <span className="category-dot" aria-hidden="true" />}
              {category.name}
            </button>
          );
        })}
      </nav>

      <div className="product-grid" aria-busy={isLoading}>
        {isLoading &&
          Array.from({ length: 8 }).map((_, index) => (
            <div className="product-card skeleton" key={index} />
          ))}

        {!isLoading && availableProducts.length === 0 && (
          <div className="empty-state">
            <Package size={28} aria-hidden="true" />
            <span>No products found</span>
          </div>
        )}

        {!isLoading &&
          availableProducts.map((product) => {
            const stock = productStock(product);
            return (
              <button
                key={product.id}
                className="product-card"
                type="button"
                aria-label={`Add ${product.name}, ${formatCurrency(product.price)}`}
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
                onClick={closeModifierSheet}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="modifier-body">
              {modifierProduct.modifier_groups.map((group) => {
                const selected = selections[group.id] ?? [];
                const minimum = requiredMinimum(group);
                const atMax = selected.length >= group.max_select;
                const countMet = selected.length >= minimum;
                const countClass = countMet ? 'met' : 'under';
                return (
                  <fieldset className="modifier-group" key={group.id}>
                    <legend>
                      <span className="modifier-group-heading">
                        <span className="modifier-group-title">{group.name}</span>
                        <span className={`modifier-requirement ${group.required ? 'required' : 'optional'}`}>
                          {group.required ? 'Required' : 'Optional'}
                        </span>
                      </span>
                      <span className={`modifier-count ${countClass}`}>{selected.length}/{group.max_select}</span>
                    </legend>
                    <div className="modifier-options">
                      {group.modifiers.map((modifier) => {
                        const checked = selected.includes(modifier.id);
                        const priceLabel = modifierPrice(modifier);
                        const maxReached = atMax && !checked;
                        return (
                          <button
                            type="button"
                            key={modifier.id}
                            className={`modifier-option ${checked ? 'selected' : ''} ${maxReached ? 'max-reached' : ''}`}
                            disabled={maxReached}
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
                    {atMax && <p className="modifier-max-hint">Maximum selected</p>}
                  </fieldset>
                );
              })}
            </div>

            {error && <p className="form-error">{error}</p>}

            <footer className="sheet-actions">
              <button className="secondary-button" type="button" onClick={closeModifierSheet}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={confirmModifiers}>
                {isEditing ? 'Update item' : 'Add item'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
