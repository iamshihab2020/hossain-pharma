'use client';

import { Star, MapPin, Clock, Shield, Phone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Vendor } from '@/types/vendor';
import Image from 'next/image';

interface VendorCardProps {
  vendor: Vendor;
  onSelect?: () => void;
  compact?: boolean;
}

export function VendorCard({ vendor, onSelect, compact = false }: VendorCardProps) {
  return (
    <Card className="p-4 hover:shadow-lg transition-all">
      <div className="flex items-start gap-4">
        <Image
          src={vendor.logo}
          alt={`${vendor.name} logo`}
          width={compact ? 48 : 64}
          height={compact ? 48 : 64}
          className="rounded-lg object-cover"
        />

        <div className="flex-1">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                {vendor.name}
                {vendor.isVerified && (
                  <Badge variant="outline" className="text-verified border-verified">
                    <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
                    Verified
                  </Badge>
                )}
              </h3>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" aria-hidden="true" />
                <span className="font-medium">{vendor.rating.overall}</span>
                <span>({vendor.rating.totalReviews} reviews)</span>
              </div>
            </div>
          </div>

          {!compact && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {vendor.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="w-4 h-4" aria-hidden="true" />
              <span>{vendor.location.distanceFromUser} mi away</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-4 h-4" aria-hidden="true" />
              <span>{vendor.deliveryTime}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {vendor.specializations.slice(0, 3).map((spec) => (
              <Badge key={spec} variant="secondary" className="text-xs">
                {spec}
              </Badge>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1">
              View Profile
            </Button>
            {onSelect && (
              <Button size="sm" onClick={onSelect} className="flex-1">
                Select Vendor
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
