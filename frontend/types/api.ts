// Backend product type (different from frontend vendor-based type)
export interface BackendProduct {
  _id: string;
  name: string;
  genericName?: string;
  description: string;
  category: string;
  categoryTag: string;
  image: string;
  images?: string[];
  price: number;
  discountPrice?: number;
  prescriptionRequired: boolean;
  manufacturer: string;
  stock?: number;
  email?: string; // seller email
  createdAt: Date;
  updatedAt?: Date;
}

export interface AdminStats {
  users: number;
  productsItem: number;
  orders: number;
  revenue: number;
  statusCounts: {
    pending: number;
    accepted: number;
  };
  roleCounts: {
    user: number;
    seller: number;
    admin: number;
  };
}

export interface OrderStats {
  category: string;
  quantity: number;
  revenue: number;
}

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
}

export interface InsertResult {
  acknowledged: boolean;
  insertedId: string;
}

export interface UpdateResult {
  acknowledged: boolean;
  modifiedCount: number;
  matchedCount: number;
}

export interface DeleteResult {
  acknowledged: boolean;
  deletedCount: number;
}
