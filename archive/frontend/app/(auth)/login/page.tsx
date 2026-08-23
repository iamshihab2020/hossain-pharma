import { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Sign In | Hossain Pharma',
  description: 'Sign in to your Hossain Pharma account',
};

export default function LoginPage() {
  return <LoginForm />;
}
