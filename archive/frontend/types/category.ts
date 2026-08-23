export interface Category {
  _id: string;
  name: string;
  categoryTag: string;
  image?: string;
  description?: string;
  productCount?: number;
}

export interface CreateCategoryPayload {
  name: string;
  categoryTag: string;
  image?: string;
  description?: string;
}
