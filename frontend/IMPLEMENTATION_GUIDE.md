# Homepage Redesign - Implementation Guide

## Completed So Far ✅

### 1. Foundation (Complete)
- ✅ TypeScript types created:
  - `types/vendor.ts` - Vendor-related interfaces
  - `types/prescription.ts` - Prescription management types
  - `types/drug-interaction.ts` - Drug interaction checker types
  - `types/product.ts` - Enhanced product with vendor pricing

### 2. Mock Data (Complete)
- ✅ `lib/mock-data/vendors.ts` - 6 mock pharmacies with full details
- ✅ `lib/mock-data/testimonials.ts` - 8 customer testimonials
- ✅ `lib/mock-data/drug-interactions.ts` - Sample drug interactions database
- ✅ `lib/mock-data/products-enhanced.ts` - 10 products with multi-vendor pricing

### 3. Configuration (Complete)
- ✅ `tailwind.config.ts` - Healthcare color palette added (trust, health, success, warning, danger, verified)

### 4. Components Created (Complete)
- ✅ `components/accessibility/skip-link.tsx` - WCAG accessibility
- ✅ `components/trust/certification-badges.tsx` - Trust badges row
- ✅ `components/trust/trust-banner.tsx` - Statistics banner
- ✅ `components/features/prescription-upload/upload-modal.tsx` - Prescription upload
- ✅ `components/features/drug-interaction/checker-modal.tsx` - Drug interaction tool

## Remaining Components to Create

### 5. Vendor Components
Create these files:

#### `components/features/vendor-comparison/vendor-card.tsx`
```tsx
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
```

#### `components/features/vendor-comparison/vendor-showcase.tsx`
```tsx
'use client';

import { VendorCard } from './vendor-card';
import { getFeaturedVendors } from '@/lib/mock-data/vendors';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export function VendorShowcase() {
  const featuredVendors = getFeaturedVendors();

  return (
    <section className="py-16" aria-labelledby="featured-vendors-heading">
      <div className="container">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 id="featured-vendors-heading" className="text-3xl font-bold mb-2">
              Featured Pharmacies
            </h2>
            <p className="text-muted-foreground">
              Trusted and verified pharmacy partners near you
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/vendors">
              View All
              <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredVendors.slice(0, 3).map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
        </div>
      </div>
    </section>
  );
}
```

### 6. Enhanced Product Card
#### `components/ui/product-card-enhanced.tsx`
```tsx
'use client';

import { ShoppingCart, Heart, Eye, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductWithVendor } from '@/types/product';
import Image from 'next/image';

interface ProductCardEnhancedProps {
  product: ProductWithVendor;
}

export function ProductCardEnhanced({ product }: ProductCardEnhancedProps) {
  const lowestPriceVendor = product.vendorPricing[0]; // Assuming sorted by price

  return (
    <Card className="group overflow-hidden hover:shadow-xl transition-all">
      <div className="relative aspect-square overflow-hidden bg-muted">
        <Image
          src={product.image}
          alt={product.name}
          fill
          className="object-cover group-hover:scale-105 transition-transform"
        />

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {product.prescriptionRequired && (
            <Badge variant="destructive" className="text-xs">
              Rx Required
            </Badge>
          )}
          {product.isDiscounted && lowestPriceVendor.discount && (
            <Badge variant="default" className="bg-danger text-xs">
              {lowestPriceVendor.discount}% OFF
            </Badge>
          )}
        </div>

        {/* Quick Actions */}
        <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="secondary" className="rounded-full" aria-label="Add to wishlist">
            <Heart className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="secondary" className="rounded-full" aria-label="Quick view">
            <Eye className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold mb-1 line-clamp-1">{product.name}</h3>
        {product.genericName && (
          <p className="text-xs text-muted-foreground mb-2">{product.genericName}</p>
        )}

        {/* Vendor Info */}
        {lowestPriceVendor && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" aria-hidden="true" />
            <span>{lowestPriceVendor.vendorName}</span>
            {lowestPriceVendor.isVerified && (
              <Badge variant="outline" className="text-xs px-1">Verified</Badge>
            )}
          </div>
        )}

        {/* Stock Status */}
        {lowestPriceVendor?.inStock ? (
          <Badge variant="outline" className="text-xs text-success border-success mb-2">
            In Stock
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-danger border-danger mb-2">
            Out of Stock
          </Badge>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-lg font-bold">${product.lowestPrice}</span>
          {product.vendorCount > 1 && (
            <span className="text-xs text-muted-foreground">
              from {product.vendorCount} vendors
            </span>
          )}
        </div>

        {/* Rating */}
        <div className="flex items-center gap-1 text-sm mb-3">
          <div className="flex">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${
                  i < Math.floor(product.averageRating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-muted'
                }`}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            ({product.totalReviews})
          </span>
        </div>

        <Button className="w-full" size="sm">
          <ShoppingCart className="w-4 h-4 mr-2" aria-hidden="true" />
          {product.vendorCount > 1 ? 'Compare & Add' : 'Add to Cart'}
        </Button>
      </div>
    </Card>
  );
}
```

### 7. Homepage Sections

#### `components/pages/home/quick-tools.tsx`
```tsx
'use client';

import { useState } from 'react';
import { FileText, AlertTriangle, MapPin, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PrescriptionUploadModal } from '@/components/features/prescription-upload/upload-modal';
import { DrugInteractionChecker } from '@/components/features/drug-interaction/checker-modal';

const tools = [
  {
    icon: <FileText className="w-8 h-8" aria-hidden="true" />,
    title: 'Upload Prescription',
    description: 'Upload your prescription for quick ordering',
    color: 'text-trust',
    modal: 'prescription',
  },
  {
    icon: <AlertTriangle className="w-8 h-8" aria-hidden="true" />,
    title: 'Drug Interaction Checker',
    description: 'Check if your medications interact',
    color: 'text-warning',
    modal: 'drugChecker',
  },
  {
    icon: <MapPin className="w-8 h-8" aria-hidden="true" />,
    title: 'Find Nearby Pharmacy',
    description: 'Locate pharmacies near your location',
    color: 'text-health',
    modal: null,
  },
  {
    icon: <Search className="w-8 h-8" aria-hidden="true" />,
    title: 'Symptom Search',
    description: 'Find medicines based on symptoms',
    color: 'text-purple-500',
    modal: null,
  },
];

export function QuickTools() {
  const [prescriptionOpen, setPrescriptionOpen] = useState(false);
  const [drugCheckerOpen, setDrugCheckerOpen] = useState(false);

  const handleToolClick = (modal: string | null) => {
    if (modal === 'prescription') setPrescriptionOpen(true);
    if (modal === 'drugChecker') setDrugCheckerOpen(true);
  };

  return (
    <>
      <section className="py-12 bg-muted/30" aria-labelledby="quick-tools-heading">
        <div className="container">
          <div className="text-center mb-8">
            <h2 id="quick-tools-heading" className="text-3xl font-bold mb-2">
              Quick Access Tools
            </h2>
            <p className="text-muted-foreground">
              Essential healthcare tools at your fingertips
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {tools.map((tool) => (
              <Card
                key={tool.title}
                className="p-6 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => handleToolClick(tool.modal)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleToolClick(tool.modal);
                  }
                }}
              >
                <div className={`${tool.color} mb-3 group-hover:scale-110 transition-transform`}>
                  {tool.icon}
                </div>
                <h3 className="font-semibold mb-2">{tool.title}</h3>
                <p className="text-sm text-muted-foreground">{tool.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <PrescriptionUploadModal open={prescriptionOpen} onOpenChange={setPrescriptionOpen} />
      <DrugInteractionChecker open={drugCheckerOpen} onOpenChange={setDrugCheckerOpen} />
    </>
  );
}
```

#### `components/pages/home/how-it-works.tsx`
```tsx
'use client';

import { Search, FileCheck, Package, CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const steps = [
  {
    icon: <Search className="w-8 h-8" aria-hidden="true" />,
    title: 'Search Medicines',
    description: 'Browse or search for the medicines you need from thousands of options',
  },
  {
    icon: <FileCheck className="w-8 h-8" aria-hidden="true" />,
    title: 'Upload Prescription',
    description: 'Upload your prescription if required. Our pharmacist will verify it',
  },
  {
    icon: <Package className="w-8 h-8" aria-hidden="true" />,
    title: 'Compare & Order',
    description: 'Compare prices across vendors and place your order with best deal',
  },
  {
    icon: <CheckCircle className="w-8 h-8" aria-hidden="true" />,
    title: 'Fast Delivery',
    description: 'Get your medicines delivered to your doorstep within hours',
  },
];

export function HowItWorks() {
  return (
    <section className="py-16 bg-gradient-to-b from-background to-muted/30" aria-labelledby="how-it-works-heading">
      <div className="container">
        <div className="text-center mb-12">
          <h2 id="how-it-works-heading" className="text-3xl font-bold mb-2">
            How It Works
          </h2>
          <p className="text-muted-foreground">
            Simple steps to get your medicines delivered
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="text-center relative"
            >
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-10 left-[60%] w-[80%] h-0.5 bg-border" aria-hidden="true" />
              )}

              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center text-primary relative z-10">
                {step.icon}
              </div>

              <div className="w-8 h-8 mx-auto mb-3 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                {index + 1}
              </div>

              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

#### `components/pages/home/testimonials.tsx`
```tsx
'use client';

import { Star, Quote } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getTopTestimonials } from '@/lib/mock-data/testimonials';
import Image from 'next/image';
import { motion } from 'framer-motion';

export function Testimonials() {
  const testimonials = getTopTestimonials(6);

  return (
    <section className="py-16" aria-labelledby="testimonials-heading">
      <div className="container">
        <div className="text-center mb-12">
          <h2 id="testimonials-heading" className="text-3xl font-bold mb-2">
            What Our Customers Say
          </h2>
          <p className="text-muted-foreground">
            Trusted by thousands of satisfied customers
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
            >
              <Card className="p-6 h-full flex flex-col">
                <Quote className="w-8 h-8 text-muted-foreground mb-3" aria-hidden="true" />

                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${
                        i < testimonial.rating
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-muted'
                      }`}
                      aria-hidden="true"
                    />
                  ))}
                </div>

                <p className="text-sm mb-4 flex-grow">{testimonial.review}</p>

                <div className="flex items-center gap-3 pt-4 border-t">
                  <Image
                    src={testimonial.customerAvatar}
                    alt={testimonial.customerName}
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{testimonial.customerName}</div>
                    {testimonial.vendorName && (
                      <div className="text-xs text-muted-foreground">
                        {testimonial.vendorName}
                      </div>
                    )}
                  </div>
                  {testimonial.isVerified && (
                    <Badge variant="secondary" className="text-xs">
                      Verified
                    </Badge>
                  )}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

## Next Steps - Update Homepage

### Update `app/page.tsx`
Replace the current homepage structure with the new design. Import all new components and arrange them in this order:

1. `<SkipLink />` (at the very top)
2. Hero Section (enhanced with prescription CTA)
3. `<CertificationBadges />`
4. `<QuickTools />`
5. `<TrustBanner />`
6. Categories (enhanced)
7. `<HowItWorks />`
8. Featured Vendors Showcase
9. Latest Products (with enhanced cards)
10. Discounted Products (with enhanced cards)
11. Featured Products (with enhanced cards)
12. `<Testimonials />`
13. Health Resources section
14. Footer

## Testing Checklist
- [ ] All components render without errors
- [ ] Responsive design works on mobile, tablet, desktop
- [ ] Dark mode compatibility
- [ ] Accessibility (keyboard navigation, screen readers)
- [ ] Image loading and optimization
- [ ] Modal interactions (prescription upload, drug checker)
- [ ] Vendor card interactions
- [ ] Product card hover states

## Future Enhancements
- Real API integration
- User authentication flow
- Shopping cart functionality
- Actual prescription verification backend
- Real drug interaction database
- Payment integration
- Order tracking
