import { VendorPricing } from './vendor';

export interface Product {
  id: string;
  name: string;
  genericName?: string;
  description: string;
  category: string;
  subcategory?: string;
  image: string;
  images?: string[];
  prescriptionRequired: boolean;
  dosage?: string;
  strength?: string;
  form?: string; // tablet, capsule, syrup, etc.
  manufacturer: string;
  activeIngredients: string[];
  uses: string[];
  sideEffects?: string[];
  warnings?: string[];
  storageInstructions?: string;
  isGenericAvailable: boolean;
  genericSavings?: number;
  requiresRefrigeration: boolean;
  isControlledSubstance: boolean;
  vendorPricing: VendorPricing[];
  averageRating: number;
  totalReviews: number;
  isFeatured: boolean;
  isLatest: boolean;
  isDiscounted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductWithVendor extends Product {
  selectedVendor?: VendorPricing;
  lowestPrice: number;
  highestPrice: number;
  vendorCount: number;
}

export interface Testimonial {
  id: string;
  customerName: string;
  customerAvatar: string;
  rating: number;
  review: string;
  productName?: string;
  vendorName?: string;
  isVerified: boolean;
  date: Date;
  helpfulCount: number;
}
