import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthForm } from '@/components/auth-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const raw = params['next'];
  const next = typeof raw === 'string' ? raw : '/';

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <AuthForm mode="signin" next={next} />
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">
        Anything already in your cart is kept.
      </p>
    </div>
  );
}
