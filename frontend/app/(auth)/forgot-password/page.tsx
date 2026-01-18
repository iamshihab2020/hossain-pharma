import { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Reset Password | Hossain Pharma',
  description: 'Reset your Hossain Pharma account password',
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
