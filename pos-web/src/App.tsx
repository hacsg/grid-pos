import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import { WifiOff } from 'lucide-react';
import CartSidebar from '@/components/CartSidebar';
import LoginScreen from '@/components/LoginScreen';
import LoyaltySheet from '@/components/LoyaltySheet';
import PaymentModal from '@/components/PaymentModal';
import ProductGrid from '@/components/ProductGrid';
import {
  getCategories,
  getProducts,
  money,
  type LoyaltyMember,
  type LoyaltyReward,
  type Product,
} from '@/api/client';
import type { CartItem, CartModifier, Discount, LoyaltySelection, StaffSession, Totals } from '@/types';
import { tapFeedback } from '@/utils/haptics';

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

function lineKey(product: Product, modifiers: CartModifier[]): string {
  const modifierKey = modifiers
    .map((modifier) => `${modifier.id}:${modifier.modifier_name}:${modifier.price_adjustment}`)
    .sort()
    .join('|');
  return `${product.id}:${modifierKey}`;
}

function PosWorkspace() {
  const [session, setSession] = useState<StaffSession | null>(() => loadSession());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltySelection | null>(null);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

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

  const categoriesQuery = useQuery({
    queryKey: ['categories', session?.outlet.id],
    queryFn: () =>
      getCategories({
        outlet_id: session?.outlet.id,
        include_global: true,
      }),
    enabled: Boolean(session),
  });

  const productsQuery = useQuery({
    queryKey: ['products', session?.outlet.id, selectedCategoryId, search],
    queryFn: () =>
      getProducts({
        outlet_id: session?.outlet.id,
        category_id: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
        is_available: true,
        search,
      }),
    enabled: Boolean(session),
  });

  const totals = useMemo<Totals>(() => {
    const subtotal = cartItems.reduce((sum, item) => {
      const modifierTotal = item.modifiers.reduce((modifierSum, modifier) => modifierSum + modifier.price_adjustment, 0);
      return sum + (money(item.product.price) + modifierTotal) * item.quantity;
    }, 0);
    const tax = 0;
    const cartDiscount = discount?.kind === 'percent' ? subtotal * (discount.amount / 100) : discount?.amount ?? 0;
    const loyaltyDiscount = loyalty?.reward?.discount_amount ?? 0;
    const total = Math.max(0, subtotal + tax - cartDiscount - loyaltyDiscount);
    return {
      subtotal,
      tax,
      discount: cartDiscount,
      loyaltyDiscount,
      total,
    };
  }, [cartItems, discount, loyalty]);

  function handleLogin(nextSession: StaffSession) {
    setSession(nextSession);
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    localStorage.setItem('auth_token', nextSession.token);
  }

  function handleLogout() {
    tapFeedback();
    setSession(null);
    setCartItems([]);
    setDiscount(null);
    setLoyalty(null);
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

  function clearCart() {
    tapFeedback();
    setCartItems([]);
    setDiscount(null);
    setLoyalty(null);
  }

  function parkCart() {
    tapFeedback();
    if (cartItems.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    localStorage.setItem(
      PARKED_CART_KEY,
      JSON.stringify({
        parkedAt: new Date().toISOString(),
        items: cartItems,
        discount,
        loyalty,
      })
    );
    clearCart();
    toast.success('Cart parked');
  }

  function toggleDiscount() {
    tapFeedback();
    setDiscount((current) => (current ? null : { label: '10% staff discount', amount: 10, kind: 'percent' }));
  }

  function handleCustomerSelect(customer: LoyaltyMember) {
    setLoyalty((current) => ({
      customer,
      reward: current?.customer.member_id === customer.member_id ? current.reward : null,
    }));
  }

  function handleRedeem(reward: LoyaltyReward) {
    tapFeedback();
    if (!loyalty?.customer) {
      return;
    }
    setLoyalty({ customer: loyalty.customer, reward });
  }

  function handleOrderComplete() {
    setCartItems([]);
    setDiscount(null);
    setLoyalty(null);
    setCartOpen(false);
  }

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
          search={search}
          outletName={session.outlet.name}
          staffName={session.staff.name}
          isLoading={productsQuery.isLoading || categoriesQuery.isLoading}
          onCategoryChange={setSelectedCategoryId}
          onSearchChange={setSearch}
          onAddProduct={addProduct}
          onLogout={handleLogout}
        />
        <CartSidebar
          items={cartItems}
          totals={totals}
          discount={discount}
          loyalty={loyalty}
          isOpen={cartOpen}
          onToggleOpen={() => setCartOpen((open) => !open)}
          onIncrement={(lineId) => updateQuantity(lineId, 1)}
          onDecrement={(lineId) => updateQuantity(lineId, -1)}
          onRemove={removeItem}
          onPark={parkCart}
          onDiscount={toggleDiscount}
          onLoyalty={() => setLoyaltyOpen(true)}
          onClear={clearCart}
          onCheckout={() => setPaymentOpen(true)}
        />
      </main>
      <LoyaltySheet
        open={loyaltyOpen}
        selectedCustomer={loyalty?.customer ?? null}
        selectedReward={loyalty?.reward ?? null}
        onClose={() => setLoyaltyOpen(false)}
        onCustomerSelect={handleCustomerSelect}
        onRedeem={handleRedeem}
        onSkip={() => {
          setLoyalty(null);
          setLoyaltyOpen(false);
        }}
        onContinue={() => setLoyaltyOpen(false)}
      />
      <PaymentModal
        open={paymentOpen}
        session={session}
        items={cartItems}
        totals={totals}
        discount={discount}
        loyalty={loyalty}
        onClose={() => setPaymentOpen(false)}
        onOrderComplete={handleOrderComplete}
      />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PosWorkspace />
      <Toaster
        position="top-right"
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
  );
}
