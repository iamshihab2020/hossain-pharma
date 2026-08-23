export interface VendorRating {
  overall: number;
  productQuality: number;
  deliverySpeed: number;
  customerService: number;
  packagingQuality: number;
  priceFairness: number;
  totalReviews: number;
}

export interface VendorLocation {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  distanceFromUser?: number; // in miles
}

export interface VendorCertification {
  name: string;
  issuer: string;
  verified: boolean;
  expiryDate?: string;
}

export interface VendorOperatingHours {
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
}

export interface Vendor {
  id: string;
  name: string;
  slug: string;
  logo: string;
  description: string;
  rating: VendorRating;
  location: VendorLocation;
  certifications: VendorCertification[];
  isVerified: boolean;
  isFeatured: boolean;
  yearsInBusiness: number;
  licenseNumber: string;
  operatingHours: VendorOperatingHours;
  specializations: string[];
  deliveryTime: string; // e.g., "2-4 hours"
  minimumOrder: number;
  deliveryFee: number;
  freeDeliveryOver: number;
  acceptsInsurance: boolean;
  hasPharmacist: boolean;
  responseTime: string; // e.g., "Within 2 hours"
  totalProducts: number;
  phoneNumber: string;
  email: string;
  website?: string;
}

export interface VendorPricing {
  vendorId: string;
  vendorName: string;
  vendorRating: number;
  vendorLogo: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  inStock: boolean;
  stockQuantity: number;
  deliveryTime: string;
  distance: number;
  isVerified: boolean;
}
