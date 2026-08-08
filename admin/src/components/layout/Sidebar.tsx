import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  SlidersHorizontal,
  Tags,
  ShoppingCart,
  Users,
  Store,
  BarChart3,
  TrendingUp,
  IceCream,
  Lightbulb,
  Megaphone,
  Ticket,
  BadgePercent,
  Printer,
  Wallet,
  X,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/flavours', icon: IceCream, label: 'Flavours' },
  { to: '/tills', icon: Wallet, label: 'Tills' },
  { to: '/products', icon: Package, label: 'Products' },
  { to: '/modifiers', icon: SlidersHorizontal, label: 'Modifiers' },
  { to: '/categories', icon: Tags, label: 'Categories' },
  { to: '/orders', icon: ShoppingCart, label: 'Orders' },
  { to: '/staff', icon: Users, label: 'Staff' },
  { to: '/outlets', icon: Store, label: 'Outlets' },
  { to: '/discounts', icon: BadgePercent, label: 'Discounts' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { to: '/vouchers', icon: Ticket, label: 'Vouchers' },
  { to: '/print-templates', icon: Printer, label: 'Print Templates' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <aside
      className={`fixed left-0 top-0 z-50 flex h-dvh w-60 flex-col border-r border-gray-100 bg-white transition-transform duration-200 lg:z-40 lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-gray-100 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-white">G</span>
          </div>
          <span className="text-base font-semibold text-text">Grid POS</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-100 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <span className="text-xs font-semibold text-primary">A</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text truncate">Admin</p>
            <p className="text-xs text-text-muted truncate">admin@gridpos.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
