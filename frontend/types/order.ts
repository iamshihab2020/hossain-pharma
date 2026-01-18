export type PaymentStatus = 'pending' | 'accepted' | 'rejected';

export interface Payment {
  _id: string;
  email: string;
  transactionId: string;
  price: number;
  cartIds: string[];
  productsIds: string[];
  productNames: string[];
  status: PaymentStatus;
  createdAt: Date;
}

export interface CreatePaymentPayload {
  email: string;
  transactionId: string;
  price: number;
  cartIds: string[];
  productsIds: string[];
  productNames: string[];
  status: PaymentStatus;
}

export interface PaymentIntent {
  clientSecret: string;
}

export interface CreatePaymentIntentPayload {
  price: number;
}

export interface Invoice {
  _id: string;
  email: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  transactionId: string;
  createdAt: Date;
}

export interface CreateInvoicePayload {
  email: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  transactionId: string;
}
