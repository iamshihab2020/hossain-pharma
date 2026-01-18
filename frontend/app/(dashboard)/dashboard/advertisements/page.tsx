'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Megaphone,
  CheckCircle,
  XCircle,
  Clock,
  MoreHorizontal,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  getAllAds,
  acceptAd,
  rejectAd,
  approveAdToCollection,
} from '@/lib/api/ads';
import { Advertisement } from '@/types/ads';

export default function AdminAdsPage() {
  const queryClient = useQueryClient();

  const { data: ads = [], isLoading } = useQuery({
    queryKey: ['admin-ads'],
    queryFn: getAllAds,
  });

  const acceptMutation = useMutation({
    mutationFn: async (ad: Advertisement) => {
      await acceptAd(ad._id);
      await approveAdToCollection(ad);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-ads'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectAd,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-ads'] }),
  });

  if (isLoading) {
    return <PageLoader text="Loading advertisements..." />;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return <Badge className="bg-green-500">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  // Stats
  const totalAds = ads.length;
  const pendingAds = ads.filter((a) => a.adsStatus === 'pending').length;
  const approvedAds = ads.filter((a) => a.adsStatus === 'accepted').length;
  const rejectedAds = ads.filter((a) => a.adsStatus === 'rejected').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Advertisement Management</h1>
        <p className="text-muted-foreground">
          Review and approve seller advertisements
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Ads</CardTitle>
            <Megaphone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAds}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingAds}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvedAds}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rejectedAds}</div>
          </CardContent>
        </Card>
      </div>

      {/* Ads table */}
      {ads.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No advertisements yet"
          description="Seller advertisements will appear here for review."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Advertisements</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Preview</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ads.map((ad: Advertisement) => (
                  <TableRow key={ad._id}>
                    <TableCell>
                      <div className="h-12 w-20 rounded bg-muted flex items-center justify-center overflow-hidden">
                        {ad.image ? (
                          <img
                            src={ad.image}
                            alt={ad.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{ad.title}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {ad.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{ad.email}</TableCell>
                    <TableCell>
                      {format(new Date(ad.createdAt), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell>{getStatusBadge(ad.adsStatus)}</TableCell>
                    <TableCell className="text-right">
                      {ad.adsStatus === 'pending' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => acceptMutation.mutate(ad)}
                            >
                              <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                              Approve Ad
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => rejectMutation.mutate(ad._id)}
                            >
                              <XCircle className="mr-2 h-4 w-4 text-red-500" />
                              Reject Ad
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
