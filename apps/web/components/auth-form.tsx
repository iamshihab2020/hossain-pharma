'use client';

import Link from 'next/link';
import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { register, signIn, type AuthState } from '@/app/actions/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIAL: AuthState = { error: null };

/**
 * Sign-in and registration share a shape, so they share a component.
 *
 * A plain `<form action={...}>` bound to a Server Action rather than
 * react-hook-form: the fields are two or three, the validation that matters is
 * the server's, and the form works before hydration - which on a slow phone is
 * the difference between a usable page and a dead one.
 */
export function AuthForm({
  mode,
  next,
}: {
  mode: 'signin' | 'register';
  next: string;
}): ReactNode {
  const action = mode === 'signin' ? signIn : register;
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      {state.error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {mode === 'register' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="displayName">Your name</Label>
          <Input id="displayName" name="displayName" autoComplete="name" required />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          {...(mode === 'register' ? { minLength: 12 } : {})}
        />
        {mode === 'register' && (
          <p className="text-xs text-muted-foreground">
            At least 12 characters. Length matters more than symbols, so a few
            ordinary words work well.
          </p>
        )}
      </div>

      <SubmitButton label={mode === 'signin' ? 'Sign in' : 'Create account'} />

      <p className="text-sm text-muted-foreground">
        {mode === 'signin' ? (
          <>
            No account?{' '}
            <Link
              href={`/register?next=${encodeURIComponent(next)}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Create one
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link
              href={`/signin?next=${encodeURIComponent(next)}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

/** Split out because `useFormStatus` only reports for the form ABOVE it. */
function SubmitButton({ label }: { label: string }): ReactNode {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}
