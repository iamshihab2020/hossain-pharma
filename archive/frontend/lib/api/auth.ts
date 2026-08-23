import { apiClient, setAuthToken } from './client';
import {
  User,
  AuthUser,
  JwtResponse,
  AdminCheck,
  SellerCheck
} from '@/types/user';

export interface CreateUserPayload {
  name: string;
  email: string;
  photoURL?: string;
  role?: string;
}

// Generate JWT token
export const generateJwt = async (email: string): Promise<JwtResponse> => {
  const response = await apiClient.post<JwtResponse>('/jwt', { email });
  return response.data;
};

// Create user in backend (after Firebase auth)
export const createUser = async (userData: CreateUserPayload): Promise<{ message?: string; insertedId: string | null }> => {
  const response = await apiClient.post('/users', {
    ...userData,
    role: userData.role || 'user',
  });
  return response.data;
};

// Check if user is admin
export const checkIsAdmin = async (email: string): Promise<boolean> => {
  try {
    const response = await apiClient.get<AdminCheck>(`/users/admin/${email}`);
    return response.data.admin;
  } catch {
    return false;
  }
};

// Check if user is seller
export const checkIsSeller = async (email: string): Promise<boolean> => {
  try {
    const response = await apiClient.get<SellerCheck>(`/users/seller/${email}`);
    return response.data.seller;
  } catch {
    return false;
  }
};

// Login flow: generate JWT and optionally fetch user role
export const loginUser = async (
  email: string
): Promise<{ token: string; isAdmin: boolean; isSeller: boolean }> => {
  // Generate JWT
  const { token } = await generateJwt(email);
  setAuthToken(token);

  // Check roles
  const [isAdmin, isSeller] = await Promise.all([
    checkIsAdmin(email),
    checkIsSeller(email),
  ]);

  return { token, isAdmin, isSeller };
};

// Register new user
export const registerUser = async (
  userData: CreateUserPayload
): Promise<{ token: string; user: AuthUser }> => {
  // Create user in backend
  await createUser(userData);

  // Generate JWT
  const { token } = await generateJwt(userData.email);
  setAuthToken(token);

  const user: AuthUser = {
    name: userData.name,
    email: userData.email,
    photoURL: userData.photoURL,
    role: 'user',
    token,
  };

  return { token, user };
};

// Logout
export const logoutUser = () => {
  setAuthToken(null);
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth-storage');
  }
};

// Get user role from backend
export const getUserRole = async (
  email: string
): Promise<'admin' | 'seller' | 'user'> => {
  const [isAdmin, isSeller] = await Promise.all([
    checkIsAdmin(email),
    checkIsSeller(email),
  ]);

  if (isAdmin) return 'admin';
  if (isSeller) return 'seller';
  return 'user';
};
