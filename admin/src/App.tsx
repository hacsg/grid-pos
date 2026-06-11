import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import Layout from '@/components/layout/Layout';
import Dashboard from '@/pages/Dashboard';
import Products from '@/pages/Products';
import Categories from '@/pages/Categories';
import Modifiers from '@/pages/Modifiers';
import Orders from '@/pages/Orders';
import Staff from '@/pages/Staff';
import Outlets from '@/pages/Outlets';
import Reports from '@/pages/Reports';
import Vouchers from '@/pages/Vouchers';
import Discounts from '@/pages/Discounts';
import Campaigns from '@/pages/Campaigns';
import Customers from '@/pages/Customers';
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
            <Route path="products" element={<Products />} />
            <Route path="modifiers" element={<Modifiers />} />
            <Route path="categories" element={<Categories />} />
            <Route path="orders" element={<Orders />} />
            <Route path="staff" element={<Staff />} />
            <Route path="outlets" element={<Outlets />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="customers" element={<Customers />} />
            <Route path="reports" element={<Reports />} />
            <Route path="vouchers" element={<Vouchers />} />
            <Route path="discounts" element={<Discounts />} />
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
