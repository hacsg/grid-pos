import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import { ChevronDown, LogOut, WifiOff, X } from 'lucide-react';
import CartSidebar from '@/components/CartSidebar';
import LoginScreen from '@/components/LoginScreen';
import LoyaltySheet from '@/components/LoyaltySheet';
import PaymentModal, { manualTerminalEnabled } from '@/components/PaymentModal';
import TillPage from '@/components/TillPage';
import QuickChargeDialog from '@/components/QuickChargeDialog';
import ProductGrid from '@/components/ProductGrid';
import Scanner from '@/components/Scanner';
import TransactionsPage from '@/components/TransactionsPage';
import DiscountSheet from '@/components/DiscountSheet';
import VoucherSheet from '@/components/VoucherSheet';
import ParkedSheet from '@/components/ParkedSheet';
import CustomerDisplay from '@/display/CustomerDisplay';
import {
  getActiveDiscounts,
  getCategories,
  getCurrentTill,
  getProducts,
  SESSION_EXPIRED_EVENT,
  type LoyaltyMember,
  type LoyaltyReward,
  type Product,
} from '@/api/client';
import type { AppliedVoucher, CartItem, CartModifier, Discount, LoyaltySelection, ParkedCart, StaffSession, Totals } from '@/types';
import ErrorBoundary from '@/components/ErrorBoundary';
import { lineLabel, lineTotal } from '@/utils/cart';
import { computeCartDiscounts, type AppliedDiscountLine } from '@/utils/discounts';
import { tapFeedback } from '@/utils/haptics';
import { connectPrinter, forgetPrinter, getSavedPrinter, isPrintingSupported } from '@/utils/printer';
import { broadcast } from '@/display/channel';

const SESSION_KEY = 'grid_pos_staff_session';
const PARKED_CART_KEY = 'grid_pos_parked_cart';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function loadSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as StaffSession;
    if (!session.token || !session.staff || !session.outlet || session.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('auth_token');
      return null;
    }
    localStorage.setItem('auth_token', session.token);
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('auth_token');
    return null;
  }
}

function loadParkedCarts(): ParkedCart[] {
  try {
    const raw = localStorage.getItem(PARKED_CART_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    // New format: array of parked carts.
    if (Array.isArray(parsed)) {
      return parsed.filter((cart) => Array.isArray(cart?.items));
    }
    // Legacy format: single parked cart object — migrate to array.
    if (parsed && Array.isArray(parsed.items)) {
      return [
        {
          id: parsed.parkedAt ?? 'legacy',
          parkedAt: parsed.parkedAt ?? new Date().toISOString(),
          items: parsed.items,
          discount: parsed.discount ?? null,
          loyalty: parsed.loyalty ?? null,
          vouchers: parsed.vouchers ?? [],
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

function saveParkedCarts(carts: ParkedCart[]) {
  try {
    if (carts.length === 0) {
      localStorage.removeItem(PARKED_CART_KEY);
    } else {
      localStorage.setItem(PARKED_CART_KEY, JSON.stringify(carts));
    }
  } catch {
    // ignore storage failures
  }
}

function lineKey(product: Product, modifiers: CartModifier[]): string {
  const modifierKey = modifiers
    .map((modifier) => `${modifier.id}:${modifier.modifier_name}:${modifier.price_adjustment}`)
    .sort()
    .join('|');
  return `${product.id}:${modifierKey}`;
}

function buildDisplaySnapshot(
  items: CartItem[],
  totals: Totals,
  discount: Discount | null,
  loyalty: LoyaltySelection | null,
  vouchers: AppliedVoucher[] = [],
  brandName?: string,
  brandLogoUrl?: string | null
) {
  const displayItems = items.map((item) => ({
    name: lineLabel(item),
    quantity: item.quantity,
    lineTotal: lineTotal(item),
    modifiers: item.modifiers.map((m) => m.modifier_name),
  }));

  const voucherDiscount = vouchers.reduce((s, v) => s + v.amount, 0);

  return {
    items: displayItems,
    subtotal: totals.subtotal,
    // Targeted rule discounts fold into the single line the display shows so
    // subtotal − discount − loyalty − vouchers still equals the total.
    discount: totals.discount + totals.targetedDiscount,
    loyaltyDiscount: totals.loyaltyDiscount,
    voucherDiscount,
    total: totals.total,
    loyaltyCustomerName: loyalty?.customer?.name,
    brandName: brandName ?? 'HAC',
    brandLogoUrl: brandLogoUrl ?? null,
  };
}

function syncDisplay(
  items: CartItem[],
  totals: Totals,
  discount: Discount | null,
  loyalty: LoyaltySelection | null,
  vouchers: AppliedVoucher[] = [],
  brandName?: string,
  brandLogoUrl?: string | null
) {
  try {
    broadcast({
      type: 'ORDER_UPDATE',
      payload: buildDisplaySnapshot(items, totals, discount, loyalty, vouchers, brandName, brandLogoUrl),
    });
  } catch {
    // Never block cashier on display broadcast
  }
}

interface PosWorkspaceProps {
  session?: StaffSession | null;
  onLogout?: () => void;
}

function PosWorkspace(props: PosWorkspaceProps = {}) {
  const [internalSession, setInternalSession] = useState<StaffSession | null>(() =>
    props.session ?? loadSession()
  );
  const session = props.session ?? internalSession;
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltySelection | null>(null);
  const [vouchers, setVouchers] = useState<AppliedVoucher[]>([]);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [discountPickerOpen, setDiscountPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [parkedCarts, setParkedCarts] = useState<ParkedCart[]>(() => loadParkedCarts());
  const [parkedOpen, setParkedOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [cartScanConfirmed, setCartScanConfirmed] = useState(false);
  const [quickChargeOpen, setQuickChargeOpen] = useState(false);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!cartScanConfirmed) {
      return;
    }
    const timer = window.setTimeout(() => setCartScanConfirmed(false), 500);
    return () => window.clearTimeout(timer);
  }, [cartScanConfirmed]);

  const categoriesQuery = useQuery({
    queryKey: ['categories', session?.outlet.id],
    queryFn: () =>
      getCategories({
        outlet_id: session?.outlet.id,
        include_global: true,
      }),
    enabled: Boolean(session),
  });

  // No "All" tab: land on the first category once categories load (or if the
  // current selection is no longer valid).
  useEffect(() => {
    const cats = categoriesQuery.data;
    if (!cats || cats.length === 0) return;
    const sorted = [...cats].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    if (selectedCategoryId === 'all' || !sorted.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(sorted[0].id);
    }
  }, [categoriesQuery.data, selectedCategoryId]);

  const productsQuery = useQuery({
    queryKey: ['products', session?.outlet.id, selectedCategoryId, search],
    queryFn: () =>
      getProducts({
        outlet_id: session?.outlet.id,
        category_id: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
        is_available: true,
        include_modifiers: true,
        search,
      }),
    enabled: Boolean(session),
  });

  // The seeded open-price "Quick Charge" product, for ad-hoc upcharges.
  const quickChargeQuery = useQuery({
    queryKey: ['quick-charge-product', session?.outlet.id],
    queryFn: () => getProducts({ outlet_id: session?.outlet.id, is_available: true }),
    enabled: Boolean(session),
    select: (products: Product[]) => products.find((p) => p.is_open_price) ?? null,
  });
  const quickChargeProduct = quickChargeQuery.data ?? null;

  const discountsQuery = useQuery({
    queryKey: ['discounts'],
    queryFn: getActiveDiscounts,
    enabled: Boolean(session),
  });

  // Auto-applied targeted rules + the manual whole-cart discount. Computed once
  // here so totals, the cart summary, the receipt, and the order payload agree.
  const cartDiscounts = useMemo(
    () => computeCartDiscounts(cartItems, discount, discountsQuery.data ?? [], session?.outlet.id),
    [cartItems, discount, discountsQuery.data, session],
  );
  const appliedDiscountLines = useMemo<AppliedDiscountLine[]>(
    () => [...cartDiscounts.targeted, ...(cartDiscounts.cart ? [cartDiscounts.cart] : [])],
    [cartDiscounts],
  );

  const totals = useMemo<Totals>(() => {
    const subtotal = cartItems.reduce((sum, item) => sum + lineTotal(item), 0);
    const tax = 0;
    const cartDiscount = cartDiscounts.cartTotal;
    const targetedDiscount = cartDiscounts.targetedTotal;
    const loyaltyDiscount = loyalty?.reward?.discount_amount ?? 0;
    const voucherDiscount = vouchers.reduce((s, v) => s + v.amount, 0);
    const total = Math.max(
      0,
      subtotal + tax - cartDiscount - targetedDiscount - loyaltyDiscount - voucherDiscount,
    );
    return {
      subtotal,
      tax,
      discount: cartDiscount,
      targetedDiscount,
      loyaltyDiscount,
      voucherDiscount,
      total,
    };
  }, [cartItems, cartDiscounts, loyalty, vouchers]);

  const editItem = useMemo(() => {
    if (!editingLineId) {
      return null;
    }
    const item = cartItems.find((entry) => entry.lineId === editingLineId);
    if (!item || item.modifiers.length === 0) {
      return null;
    }
    return {
      lineId: item.lineId,
      product: item.product,
      modifiers: item.modifiers,
    };
  }, [editingLineId, cartItems]);

  // Broadcast order state to customer display (non-blocking)
  useEffect(() => {
    if (!session) {
      return;
    }
    syncDisplay(cartItems, totals, discount, loyalty, vouchers, session.outlet.name, session.outlet.logo_url);
  }, [cartItems, discount, loyalty, vouchers, totals, session]);

  // When the customer display (2nd screen) loads, it sends DISPLAY_HELLO; reply
  // with the current snapshot so its idle/welcome screen shows the shop branding.
  useEffect(() => {
    if (!session || typeof BroadcastChannel === 'undefined') {
      return;
    }
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel('grid-pos-display');
    } catch {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'DISPLAY_HELLO') {
        syncDisplay(cartItems, totals, discount, loyalty, vouchers, session.outlet.name, session.outlet.logo_url);
      }
    };
    ch.addEventListener('message', onMessage);
    return () => {
      ch?.removeEventListener('message', onMessage);
      try { ch?.close(); } catch { /* ignore */ }
    };
  }, [cartItems, discount, loyalty, vouchers, totals, session]);

  function handleLogin(nextSession: StaffSession) {
    if (props.session === undefined) {
      setInternalSession(nextSession);
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      localStorage.setItem('auth_token', nextSession.token);
    }
    // If parent provided session, parent owns the session state
  }

  function handleLogout() {
    tapFeedback();
    if (props.onLogout) {
      props.onLogout();
      return;
    }
    setInternalSession(null);
    setCartItems([]);
    setDiscount(null);
    setLoyalty(null);
    setVouchers([]);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('auth_token');
  }

  function addProduct(product: Product, selectedModifiers: CartModifier[] = []) {
    tapFeedback();
    const key = lineKey(product, selectedModifiers);
    setCartItems((items) => {
      const existing = items.find((item) => item.lineId === key);
      if (existing) {
        return items.map((item) =>
          item.lineId === key ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...items,
        {
          lineId: key,
          product,
          quantity: 1,
          modifiers: selectedModifiers,
        },
      ];
    });
    setCartOpen(true);
  }

  function confirmQuickCharge(amount: number, label: string) {
    if (!quickChargeProduct) {
      toast.error('Quick charge is not set up');
      return;
    }
    if (amount <= 0) {
      toast.error('Enter an amount');
      return;
    }
    setCartItems((items) => [
      ...items,
      {
        lineId: `quick-${Date.now()}`, // unique so charges never merge
        product: quickChargeProduct,
        quantity: 1,
        modifiers: [],
        customPrice: amount,
        customLabel: label,
      },
    ]);
    setQuickChargeOpen(false);
    setCartOpen(true);
  }

  function handleSearchSubmit(nextSearch: string) {
    setSearch(nextSearch);
  }

  function handleScanSuccess() {
    setCartScanConfirmed(true);
  }

  function updateQuantity(lineId: string, delta: number) {
    tapFeedback();
    setCartItems((items) =>
      items
        .map((item) =>
          item.lineId === lineId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function removeItem(lineId: string) {
    tapFeedback();
    setCartItems((items) => items.filter((item) => item.lineId !== lineId));
  }

  function handleEditItem(lineId: string) {
    tapFeedback();
    setEditingLineId(lineId);
  }

  function handleEditProduct(lineId: string, modifiers: CartModifier[]) {
    tapFeedback();
    const item = cartItems.find((entry) => entry.lineId === lineId);
    if (!item) {
      setEditingLineId(null);
      return;
    }
    const newKey = lineKey(item.product, modifiers);
    setCartItems((items) => {
      const without = items.filter((entry) => entry.lineId !== lineId);
      const existing = without.find((entry) => entry.lineId === newKey);
      if (existing) {
        return without.map((entry) =>
          entry.lineId === newKey ? { ...entry, quantity: entry.quantity + item.quantity } : entry
        );
      }
      return [...without, { ...item, lineId: newKey, modifiers }];
    });
    setEditingLineId(null);
  }

  function clearCart() {
    tapFeedback();
    setCartItems([]);
    setDiscount(null);
    setLoyalty(null);
    setVouchers([]);
  }

  function parkCart() {
    tapFeedback();
    if (cartItems.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    const entry: ParkedCart = {
      id: `${Date.now()}`,
      parkedAt: new Date().toISOString(),
      items: cartItems,
      discount,
      loyalty,
      vouchers,
    };
    setParkedCarts((prev) => {
      const next = [entry, ...prev];
      saveParkedCarts(next);
      return next;
    });
    clearCart();
    toast.success('Cart parked');
  }

  function resumeParked(id: string) {
    tapFeedback();
    const target = parkedCarts.find((cart) => cart.id === id);
    if (!target) {
      return;
    }
    setParkedCarts((prev) => {
      // If the current cart has items, park it back in place of the resumed one.
      const remaining = prev.filter((cart) => cart.id !== id);
      const next =
        cartItems.length > 0
          ? [
              {
                id: `${Date.now()}`,
                parkedAt: new Date().toISOString(),
                items: cartItems,
                discount,
                loyalty,
                vouchers,
              },
              ...remaining,
            ]
          : remaining;
      saveParkedCarts(next);
      return next;
    });
    setCartItems(target.items);
    setDiscount(target.discount);
    setLoyalty(target.loyalty);
    setVouchers(target.vouchers);
    setParkedOpen(false);
    setCartOpen(true);
    toast.success(cartItems.length > 0 ? 'Swapped to parked cart' : 'Cart resumed');
  }

  function discardParked(id: string) {
    tapFeedback();
    setParkedCarts((prev) => {
      const next = prev.filter((cart) => cart.id !== id);
      saveParkedCarts(next);
      return next;
    });
  }

  function openDiscountPicker() {
    tapFeedback();
    setDiscountPickerOpen(true);
  }

  function applyDiscount(d: Discount) {
    setDiscount(d);
    setDiscountPickerOpen(false);
  }

  function clearDiscount() {
    setDiscount(null);
  }

  const handleCustomerSelect = useCallback((customer: LoyaltyMember) => {
    setLoyalty((current) => ({
      customer,
      reward: current?.customer.member_id === customer.member_id ? current.reward : null,
    }));
  }, []);

  const handleRedeem = useCallback((reward: LoyaltyReward) => {
    tapFeedback();
    setLoyalty((current) => {
      if (!current?.customer) return current;
      return { customer: current.customer, reward };
    });
  }, []);

  function handleApplyVoucher(v: AppliedVoucher) {
    tapFeedback();
    setVouchers((prev) => {
      if (prev.some((p) => p.code.toUpperCase() === v.code.toUpperCase())) return prev;
      return [...prev, v];
    });
  }

  function handleRemoveVoucher(code: string) {
    tapFeedback();
    setVouchers((prev) => prev.filter((v) => v.code !== code));
  }

  function handleOrderComplete() {
    setCartItems([]);
    setDiscount(null);
    setLoyalty(null);
    setVouchers([]);
    setCartOpen(false);
  }

  const handleCloseLoyalty = useCallback(() => setLoyaltyOpen(false), []);

  const handleSkipLoyalty = useCallback(() => {
    setLoyalty(null);
    setLoyaltyOpen(false);
  }, []);

  const handleContinueLoyalty = useCallback(() => setLoyaltyOpen(false), []);

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="pos-root">
      {!online && (
        <div className="offline-banner" role="status">
          <WifiOff size={16} aria-hidden="true" />
          Offline
        </div>
      )}
      <main className="pos-shell">
        <ProductGrid
          categories={categoriesQuery.data ?? []}
          products={productsQuery.data ?? []}
          selectedCategoryId={selectedCategoryId}
          search={searchInput}
          outletName={session.outlet.name}
          staffName={session.staff.name}
          isLoading={productsQuery.isLoading || categoriesQuery.isLoading}
          editItem={editItem}
          onCategoryChange={setSelectedCategoryId}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
          onScanSuccess={handleScanSuccess}
          onAddProduct={addProduct}
          onEditProduct={handleEditProduct}
          onEditDismiss={() => setEditingLineId(null)}
          onLogout={handleLogout}
        />
        <CartSidebar
          items={cartItems}
          totals={totals}
          discount={discount}
          appliedDiscounts={appliedDiscountLines}
          loyalty={loyalty}
          vouchers={vouchers}
          isOpen={cartOpen}
          scanConfirmed={cartScanConfirmed}
          parkedCount={parkedCarts.length}
          onOpenParked={() => setParkedOpen(true)}
          onToggleOpen={() => setCartOpen((open) => !open)}
          onIncrement={(lineId) => updateQuantity(lineId, 1)}
          onDecrement={(lineId) => updateQuantity(lineId, -1)}
          onRemove={removeItem}
          onPark={parkCart}
          onDiscount={openDiscountPicker}
          onLoyalty={() => setLoyaltyOpen(true)}
          onVouchers={() => setVoucherOpen(true)}
          onQuickCharge={() => { tapFeedback(); setQuickChargeOpen(true); }}
          onClear={clearCart}
          onEditItem={handleEditItem}
          onCheckout={() => {
            try {
              broadcast({ type: 'PAYMENT_START', payload: { total: totals.total } });
            } catch {
              // non-blocking
            }
            setPaymentOpen(true);
          }}
        />
      </main>
      <ErrorBoundary fallback={(err, reset) => (
        <div className="modal-backdrop" role="presentation">
          <section className="loyalty-sheet" role="dialog" aria-modal="true" style={{padding:24,textAlign:'center'}}>
            <h3 style={{marginBottom:8}}>Loyalty failed to load</h3>
            <p style={{fontSize:14,marginBottom:16,color:'#666'}}>{err.message}</p>
            <button className="secondary-button" onClick={() => { reset(); setLoyaltyOpen(false); }}>Close</button>
          </section>
        </div>
      )}>
        <LoyaltySheet
          open={loyaltyOpen}
          session={session}
          totals={totals}
          appliedCodes={vouchers.map((v) => v.code)}
          onSelectCustomer={handleCustomerSelect}
          onApplyVoucher={handleApplyVoucher}
          onClose={handleCloseLoyalty}
        />
      </ErrorBoundary>
      <VoucherSheet
        open={voucherOpen}
        applied={vouchers}
        loyalty={loyalty}
        onClose={() => setVoucherOpen(false)}
        onApply={handleApplyVoucher}
        onRemove={handleRemoveVoucher}
        onSelectCustomer={handleCustomerSelect}
        onContinue={() => setVoucherOpen(false)}
      />
      <DiscountSheet
        open={discountPickerOpen}
        discounts={(discountsQuery.data ?? []).filter((d) => d.scope === 'cart')}
        current={discount}
        onClose={() => setDiscountPickerOpen(false)}
        onApply={applyDiscount}
        onClear={clearDiscount}
        onContinue={() => setDiscountPickerOpen(false)}
      />
      <PaymentModal
        open={paymentOpen}
        session={session}
        items={cartItems}
        totals={totals}
        discount={discount}
        appliedDiscounts={appliedDiscountLines}
        loyalty={loyalty}
        vouchers={vouchers}
        onClose={() => {
          setPaymentOpen(false);
          // The modal broadcasts PAYMENT_CANCEL first, which frees the display
          // from the "processing"/QR screens; re-send the live cart so it shows
          // the real order again (the QR screen had cleared its snapshot). On a
          // completed sale the cart is empty and the display is mid thank-you,
          // so this no-ops harmlessly.
          syncDisplay(cartItems, totals, discount, loyalty, vouchers, session.outlet.name, session.outlet.logo_url);
        }}
        onOrderComplete={handleOrderComplete}
      />
      <ParkedSheet
        open={parkedOpen}
        parked={parkedCarts}
        onClose={() => setParkedOpen(false)}
        onResume={resumeParked}
        onDiscard={discardParked}
      />

      <QuickChargeDialog
        open={quickChargeOpen}
        onClose={() => setQuickChargeOpen(false)}
        onConfirm={confirmQuickCharge}
      />
    </div>
  );
}

function StaffTabs({ active }: { active: 'pos' | 'scanner' | 'transactions' | 'till' }) {
  return (
    <div className="staff-tabs">
      <Link
        to="/"
        className={`staff-tab ${active === 'pos' ? 'active' : ''}`}
        onPointerDown={() => tapFeedback()}
      >
        POS
      </Link>
      <Link
        to="/scanner"
        className={`staff-tab ${active === 'scanner' ? 'active' : ''}`}
        onPointerDown={() => tapFeedback()}
      >
        Scanner
      </Link>
      <Link
        to="/transactions"
        className={`staff-tab ${active === 'transactions' ? 'active' : ''}`}
        onPointerDown={() => tapFeedback()}
      >
        Transactions
      </Link>
      <Link
        to="/till"
        className={`staff-tab ${active === 'till' ? 'active' : ''}`}
        onPointerDown={() => tapFeedback()}
      >
        Till
      </Link>
    </div>
  );
}

function StaffShell() {
  const location = useLocation();
  const [session, setSession] = useState<StaffSession | null>(() => loadSession());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(() => getSavedPrinter()?.name ?? null);
  const [manualTerminal, setManualTerminal] = useState(() => manualTerminalEnabled(loadSession()));

  // The axios interceptor clears the stored session on a 401 and fires this
  // event; drop the in-memory session too so StaffShell re-renders to the login
  // screen instead of keeping a zombie session that can no longer authenticate.
  useEffect(() => {
    const onExpired = () => setSession(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  function toggleManualTerminal() {
    tapFeedback();
    setManualTerminal((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('grid_pos_manual_terminal', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function handleConnectPrinter(allDevices = false) {
    tapFeedback();
    try {
      const saved = await connectPrinter({ allDevices });
      setPrinterName(saved.name);
      toast.success(`Printer set: ${saved.name}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Could not set printer');
    }
  }

  function handleForgetPrinter() {
    tapFeedback();
    forgetPrinter();
    setPrinterName(null);
  }

  const activeTab: 'pos' | 'scanner' | 'transactions' | 'till' = location.pathname.startsWith('/till')
    ? 'till'
    : location.pathname.startsWith('/transactions')
    ? 'transactions'
    : location.pathname.startsWith('/scanner') || location.pathname.startsWith('/vouchers')
      ? 'scanner'
      : 'pos';

  function handleLogin(nextSession: StaffSession) {
    setSession(nextSession);
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    localStorage.setItem('auth_token', nextSession.token);
  }

  function handleLogout() {
    tapFeedback();
    setSession(null);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('auth_token');
  }

  const tillQuery = useQuery({
    queryKey: ['till', session?.outlet.id],
    queryFn: () => getCurrentTill(session!.outlet.id),
    enabled: Boolean(session),
  });

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const tillNotOpen = tillQuery.isFetched && tillQuery.data == null;

  const buildTime = new Date(__BUILD_TIME__).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <div className="staff-shell">
      <div className="staff-topbar">
        <StaffTabs active={activeTab} />
        <button
          className="staff-session-info"
          type="button"
          onClick={() => { tapFeedback(); setSettingsOpen(true); }}
          aria-label="Open settings"
        >
          <span className="staff-session-outlet">{session.outlet.name}</span>
          <span className="staff-session-divider">•</span>
          <span className="staff-session-staff">{session.staff.name}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>

      {tillNotOpen && (
        <Link
          className="till-open-banner"
          to="/till"
          onPointerDown={() => tapFeedback()}
        >
          Cash till not opened for today — tap to count and open
        </Link>
      )}

      <div className="staff-content">
        <Routes>
          <Route path="/scanner" element={<Scanner session={session} onLogout={handleLogout} />} />
          <Route path="/vouchers" element={<Navigate to="/scanner" replace />} />
          <Route path="/transactions" element={<TransactionsPage session={session} />} />
          <Route path="/till" element={<TillPage session={session} />} />
          <Route path="/*" element={<PosWorkspace session={session} onLogout={handleLogout} />} />
        </Routes>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="loyalty-sheet settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            style={{ maxWidth: '420px', margin: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sheet-header">
              <div>
                <p>Signed in</p>
                <h2 id="settings-title">{session.staff.name}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
                onPointerDown={() => tapFeedback()}
              >
                <X size={20} />
              </button>
            </header>

            <div className="settings-body">
              <div className="settings-row">
                <span>Outlet</span>
                <strong>{session.outlet.name}</strong>
              </div>

              {isPrintingSupported() && (
                <div className="settings-printer">
                  <div>
                    <strong>Receipt printer</strong>
                    <small>{printerName ? printerName : 'Not set — you will be asked once'}</small>
                  </div>
                  <div className="settings-printer-actions">
                    {printerName && (
                      <button className="secondary-button" type="button" onClick={handleForgetPrinter}>
                        Forget
                      </button>
                    )}
                    <button className="secondary-button" type="button" onClick={() => handleConnectPrinter()}>
                      {printerName ? 'Change' : 'Connect'}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => handleConnectPrinter(true)}
                    >
                      Show all USB devices
                    </button>
                  </div>
                </div>
              )}

              <div className="settings-row settings-toggle-row">
                <div>
                  <strong>Manual terminal mode</strong>
                  <small>
                    {manualTerminal
                      ? 'Card: key the amount into the KPay terminal, then confirm. PayNow: self-QR.'
                      : 'Off — POS drives the KPay terminal directly (needs integration).'}
                  </small>
                </div>
                <button
                  className={manualTerminal ? 'primary-button' : 'secondary-button'}
                  type="button"
                  onClick={toggleManualTerminal}
                >
                  {manualTerminal ? 'On' : 'Off'}
                </button>
              </div>

              <Link className="secondary-button settings-till-link" to="/till" onClick={() => setSettingsOpen(false)}>
                Open cash till management
              </Link>

              <div className="settings-build">
                <div className="settings-build-title">Current build</div>
                <div><span>Version</span><strong>{__BUILD_HASH__}</strong></div>
                {__BUILD_MESSAGE__ && (
                  <div className="settings-build-notes">
                    <span>Notes</span>
                    <strong>{__BUILD_MESSAGE__}</strong>
                  </div>
                )}
                <div><span>Deployed</span><strong>{buildTime} SGT</strong></div>
              </div>

              <button
                className="secondary-button danger-text settings-logout"
                type="button"
                onClick={() => { setSettingsOpen(false); handleLogout(); }}
              >
                <LogOut size={18} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/display" element={<CustomerDisplay />} />
            <Route path="/*" element={<StaffShell />} />
          </Routes>
        </BrowserRouter>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              borderRadius: '8px',
              background: '#1a1a1a',
              color: '#ffffff',
              fontSize: '14px',
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
