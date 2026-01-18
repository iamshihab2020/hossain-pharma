'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Package,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Users,
  CreditCard,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/loading-spinner';
import { useAuthStore, useUserRole } from '@/lib/stores/auth-store';
import { getSellerProducts } from '@/lib/api/products';
import { getAdminStats } from '@/lib/api/admin';
import { getUserPayments } from '@/lib/api/payments';

export default function OverviewPage() {
  const { user } = useAuthStore();
  const role = useUserRole();

  // Admin stats
  const { data: adminStats, isLoading: adminLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: getAdminStats,
    enabled: role === 'admin',
  });

  // Seller stats
  const { data: sellerProducts = [], isLoading: sellerProductsLoading } = useQuery({
    queryKey: ['seller-products', user?.email],
    queryFn: () => getSellerProducts(user!.email),
    enabled: role === 'seller' && !!user?.email,
  });

  const { data: sellerOrders = [], isLoading: sellerOrdersLoading } = useQuery({
    queryKey: ['seller-orders', user?.email],
    queryFn: () => getUserPayments(user!.email),
    enabled: role === 'seller' && !!user?.email,
  });

  if (role === 'admin' && adminLoading) {
    return <PageLoader text="Loading overview..." />;
  }

  if (role === 'seller' && (sellerProductsLoading || sellerOrdersLoading)) {
    return <PageLoader text="Loading overview..." />;
  }

  // Admin overview
  if (role === 'admin' && adminStats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard Overview</h1>
          <p className="text-muted-foreground">
            Welcome back, Admin! Here&apos;s what&apos;s happening.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${adminStats.revenue.toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                From {adminStats.orders} orders
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{adminStats.users}</div>
              <p className="text-xs text-muted-foreground">
                {adminStats.roleCounts.seller} sellers, {adminStats.roleCounts.user} customers
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Products</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{adminStats.productsItem}</div>
              <p className="text-xs text-muted-foreground">Active listings</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Orders</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{adminStats.orders}</div>
              <p className="text-xs text-muted-foreground">
                {adminStats.statusCounts.pending} pending
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Additional admin stats */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Order Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Pending</span>
                  <span className="font-medium">{adminStats.statusCounts.pending}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Accepted</span>
                  <span className="font-medium">{adminStats.statusCounts.accepted}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>User Roles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Admins</span>
                  <span className="font-medium">{adminStats.roleCounts.admin}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Sellers</span>
                  <span className="font-medium">{adminStats.roleCounts.seller}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Users</span>
                  <span className="font-medium">{adminStats.roleCounts.user}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Seller overview
  const sellerRevenue = sellerOrders.reduce((sum, o) => sum + o.price, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Seller Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here&apos;s your store overview.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">My Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sellerProducts.length}</div>
            <p className="text-xs text-muted-foreground">Active listings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${sellerRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              From {sellerOrders.length} orders
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sellerOrders.length}</div>
            <p className="text-xs text-muted-foreground">Total orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg. Order</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              $
              {sellerOrders.length > 0
                ? (sellerRevenue / sellerOrders.length).toFixed(2)
                : '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">Per order</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
