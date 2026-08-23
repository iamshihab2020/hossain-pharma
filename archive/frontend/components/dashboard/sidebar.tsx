'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Users,
  Tags,
  CreditCard,
  Megaphone,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useAuthStore, useUserRole } from '@/lib/stores/auth-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { firebaseSignOut } from '@/lib/firebase/auth';
import { logoutUser } from '@/lib/api/auth';
import { useRouter } from 'next/navigation';

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles: ('user' | 'seller' | 'admin')[];
}

const navItems: NavItem[] = [
  // Admin items
  {
    title: 'Overview',
    href: '/dashboard/overview',
    icon: LayoutDashboard,
    roles: ['admin', 'seller'],
  },
  {
    title: 'Users',
    href: '/dashboard/users',
    icon: Users,
    roles: ['admin'],
  },
  {
    title: 'All Products',
    href: '/dashboard/products',
    icon: Package,
    roles: ['admin'],
  },
  {
    title: 'Categories',
    href: '/dashboard/categories',
    icon: Tags,
    roles: ['admin'],
  },
  {
    title: 'All Orders',
    href: '/dashboard/all-orders',
    icon: CreditCard,
    roles: ['admin'],
  },

  // Seller items
  {
    title: 'My Products',
    href: '/dashboard/seller/products',
    icon: Package,
    roles: ['seller'],
  },
  {
    title: 'Seller Orders',
    href: '/dashboard/seller/orders',
    icon: ShoppingBag,
    roles: ['seller'],
  },
  {
    title: 'Advertisements',
    href: '/dashboard/seller/advertisements',
    icon: Megaphone,
    roles: ['seller'],
  },

  // Admin ads management
  {
    title: 'Manage Ads',
    href: '/dashboard/advertisements',
    icon: Megaphone,
    roles: ['admin'],
  },

  // User items
  {
    title: 'My Orders',
    href: '/dashboard/orders',
    icon: ShoppingBag,
    roles: ['user', 'seller', 'admin'],
  },
  {
    title: 'Profile',
    href: '/dashboard/profile',
    icon: User,
    roles: ['user', 'seller', 'admin'],
  },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const role = useUserRole() || 'user';
  const { logout } = useAuthStore();
  const { isSidebarOpen, toggleSidebar } = useUIStore();

  const filteredNavItems = navItems.filter((item) =>
    item.roles.includes(role as 'user' | 'seller' | 'admin')
  );

  const handleLogout = async () => {
    try {
      await firebaseSignOut();
      logoutUser();
      logout();
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 h-screen border-r bg-card transition-all duration-300',
        isSidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b px-4">
          {isSidebarOpen && (
            <Link href="/" className="font-bold text-lg">
              Hossain Pharma
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleSidebar}
          >
            {isSidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-2">
            {filteredNavItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    !isSidebarOpen && 'justify-center px-2'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {isSidebarOpen && <span>{item.title}</span>}
                </Link>
              );
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t p-2">
          <Separator className="mb-2" />
          <Button
            variant="ghost"
            className={cn(
              'w-full justify-start gap-3 text-muted-foreground hover:text-foreground',
              !isSidebarOpen && 'justify-center px-2'
            )}
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5" />
            {isSidebarOpen && <span>Logout</span>}
          </Button>
        </div>
      </div>
    </aside>
  );
}
