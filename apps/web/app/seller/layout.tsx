import Link from 'next/link';
import type { ReactNode } from 'react';
import { activeOrg } from '@/lib/api/queries';

/**
 * The seller console shell.
 *
 * **The acting organisation is permanently visible, top-left**, and that is the
 * one requirement `DESIGN-DIRECTION.md` §7 takes from the architecture rather
 * than from taste: a person can belong to more than one selling organisation,
 * every request carries the one they are acting as (`x-tenant-id`), and acting
 * in the wrong shop - repricing the wrong listing, reading the wrong order
 * queue - is a real and quiet hazard. It is not a setting buried in a menu.
 *
 * The console shares every token with the shop and diverges in DENSITY: no
 * product photography, a tabular rhythm, rows instead of tiles. It is operated
 * all day by someone who knows it, not browsed once by someone who does not.
 *
 * Moving between the buyer's account and this is a LINK, never a second login -
 * they are the same session with different capabilities.
 */
export default async function SellerLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const org = await activeOrg();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b pb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Selling as</span>
          <span className="font-semibold">{org?.displayName ?? 'No organisation'}</span>
        </div>

        <nav aria-label="Seller console">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            <li>
              <ConsoleLink href="/seller/orders">Orders</ConsoleLink>
            </li>
            <li>
              <ConsoleLink href="/seller/warehouses">Warehouses</ConsoleLink>
            </li>
            <li>
              <ConsoleLink href="/seller/cod">Cash on delivery</ConsoleLink>
            </li>
            <li>
              {/* The link back, not a sign-out. Same person, same session. */}
              <Link
                href="/orders"
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Back to shopping
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      {children}
    </div>
  );
}

/**
 * A console nav link.
 *
 * No active-state highlight, deliberately: marking the current section needs
 * `usePathname`, which would make this whole shell a client component and pull
 * the org lookup into the browser. The page heading already says where you are,
 * and it says it in a place people read.
 */
function ConsoleLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <Link href={href} className="underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
