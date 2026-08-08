import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import Layout from '@/components/layout/Layout';
import Dashboard from '@/pages/Dashboard';
import Flavours from '@/pages/Flavours';
import Tills from '@/pages/Tills';
import Products from '@/pages/Products';
import Categories from '@/pages/Categories';
import Modifiers from '@/pages/Modifiers';
import Orders from '@/pages/Orders';
import Staff from '@/pages/Staff';
import Outlets from '@/pages/Outlets';
import Discounts from '@/pages/Discounts';
import PrintTemplates from '@/pages/PrintTemplates';
import Campaigns from '@/pages/Campaigns';
import Vouchers from '@/pages/Vouchers';
import Login from '@/pages/Login';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            {/* Old bookmarks for the merged tabs land on the Dashboard */}
            <Route path="analytics" element={<Navigate to="/" replace />} />
            <Route path="insights" element={<Navigate to="/" replace />} />
            <Route path="reports" element={<Navigate to="/" replace />} />
            <Route path="flavours" element={<Flavours />} />
            <Route path="tills" element={<Tills />} />
            <Route path="products" element={<Products />} />
            <Route path="modifiers" element={<Modifiers />} />
            <Route path="categories" element={<Categories />} />
            <Route path="orders" element={<Orders />} />
            <Route path="staff" element={<Staff />} />
            <Route path="outlets" element={<Outlets />} />
            <Route path="discounts" element={<Discounts />} />
            <Route path="print-templates" element={<PrintTemplates />} />
            {/* Vouchers is the only admin surface for minting CDC voucher codes,
                and Campaigns is what supplies the campaigns it issues against.
                Both were built but never routed, so the capability existed and
                was unreachable. Grid-local customer management is deliberately
                not restored — Acre Club owns customers, and two places to edit
                one is how records drift apart. */}
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="vouchers" element={<Vouchers />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            borderRadius: '10px',
            background: '#1A1A1A',
            color: '#FFFFFF',
            fontSize: '14px',
          },
        }}
      />
    </QueryClientProvider>
  );
}
