export type UserRole = 'user' | 'seller' | 'admin';

export interface User {
  _id: string;
  name: string;
  email: string;
  photoURL?: string;
  role: UserRole;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthUser {
  _id?: string;
  name: string;
  email: string;
  photoURL?: string;
  role: UserRole;
  token?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials {
  name: string;
  email: string;
  password: string;
}

export interface JwtResponse {
  token: string;
}

export interface AdminCheck {
  admin: boolean;
}

export interface SellerCheck {
  seller: boolean;
}
