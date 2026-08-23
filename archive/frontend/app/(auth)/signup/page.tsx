import { Metadata } from 'next';
import { SignupForm } from '@/components/auth/signup-form';

export const metadata: Metadata = {
  title: 'Create Account | Hossain Pharma',
  description: 'Create a new Hossain Pharma account',
};

export default function SignupPage() {
  return <SignupForm />;
}
