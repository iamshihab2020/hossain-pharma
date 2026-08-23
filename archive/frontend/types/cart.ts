export interface CartItem {
  _id: string;
  email: string;
  productId: string;
  name: string;
  image: string;
  price: number;
  quantity: number;
  category?: string;
  prescriptionRequired?: boolean;
}

export interface AddToCartPayload {
  email: string;
  productId: string;
  name: string;
  image: string;
  price: number;
  quantity: number;
  category?: string;
  prescriptionRequired?: boolean;
}

export interface UpdateCartQuantityPayload {
  quantity: number;
}

export interface CartSummary {
  items: CartItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  itemCount: number;
}
