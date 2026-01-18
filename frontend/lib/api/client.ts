import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Request interceptor to add JWT token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Get token from localStorage (client-side only)
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('auth-token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - clear storage
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth-token');
        localStorage.removeItem('auth-storage');
        // Optionally redirect to login
        // window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Helper to set auth token
export const setAuthToken = (token: string | null) => {
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('auth-token', token);
    } else {
      localStorage.removeItem('auth-token');
    }
  }
};

// Helper to get auth token
export const getAuthToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('auth-token');
  }
  return null;
};

export default apiClient;
