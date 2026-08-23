import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * A server component, with no 'use client' directive. That is the point: the
 * archived rewrite made every page a client component and fetched nothing on
 * the server, which is the architecture this build inverts (PRD 12.1).
 *
 * The storefront arrives in Phase 2. This page exists so the build, the Tailwind
 * preset, and the salvaged primitives are all exercised by something real.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-8">
      <div className="space-y-3">
        <Badge variant="secondary">Phase 0 &middot; Foundation</Badge>
        <h1 className="text-4xl font-bold tracking-tight">NexMarket</h1>
        <p className="text-muted-foreground">
          A universal multi-tenant marketplace. Any verified seller lists anything; buyers compare
          competing offers on one product page and check out once across many sellers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What runs today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Monorepo, Postgres with forced row-level security, a tenant-scoped transaction wrapper
            proven under concurrent load, an idempotent seed, and this app.
          </p>
          <p>
            No authentication, catalogue, cart, orders or ledger yet. Those arrive in Phases 1
            through 4.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button>Primitives are wired</Button>
        <Button variant="outline">Theme tokens resolve</Button>
      </div>
    </main>
  );
}
