'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { useUserRole } from '@/lib/stores/auth-store';
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Users,
  Tags,
  CreditCard,
  Megaphone,
  User,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles: ('user' | 'seller' | 'admin')[];
}

const navItems: NavItem[] = [
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
  {
    title: 'Manage Ads',
    href: '/dashboard/advertisements',
    icon: Megaphone,
    roles: ['admin'],
  },
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

export function MobileNav() {
  const pathname = usePathname();
  const role = useUserRole() || 'user';
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useUIStore();

  const filteredNavItems = navItems.filter((item) =>
    item.roles.includes(role as 'user' | 'seller' | 'admin')
  );

  return (
    <Sheet open={isMobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b p-4">
          <div className="flex items-center justify-between">
            <SheetTitle>
              <Link href="/" className="font-bold">
                Hossain Pharma
              </Link>
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-2">
            {filteredNavItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileSidebarOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
