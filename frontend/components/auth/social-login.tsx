'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signInWithGoogle } from '@/lib/firebase/auth';
import { loginUser, createUser } from '@/lib/api/auth';
import { useAuthStore } from '@/lib/stores/auth-store';

export function SocialLogin() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Sign in with Google via Firebase
      const firebaseUser = await signInWithGoogle();

      // 2. Create/ensure user exists in backend
      await createUser({
        name: firebaseUser.displayName || 'User',
        email: firebaseUser.email!,
        photoURL: firebaseUser.photoURL || undefined,
      });

      // 3. Get JWT token and check roles
      const { token, isAdmin, isSeller } = await loginUser(firebaseUser.email!);

      // 4. Determine user role
      const role = isAdmin ? 'admin' : isSeller ? 'seller' : 'user';

      // 5. Update auth store
      login(
        {
          name: firebaseUser.displayName || 'User',
          email: firebaseUser.email!,
          photoURL: firebaseUser.photoURL || undefined,
          role,
        },
        token
      );

      // 6. Redirect
      router.push('/');
      router.refresh();
    } catch (err) {
      console.error('Google sign-in error:', err);
      if (err instanceof Error) {
        if (err.message.includes('popup-closed-by-user')) {
          // User closed the popup, not an error to display
          return;
        }
        setError('Failed to sign in with Google. Please try again.');
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        )}
        Continue with Google
      </Button>
    </div>
  );
}
