import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type CodRow } from '@nexmarket/api-client';
import { apiGet, isSignedIn } from '@/lib/api/server';
import { activeOrg } from '@/lib/api/queries';
import { CollectCodForm } from '@/components/collect-cod-form';
import { formatMoney } from '@/lib/format';

export const metadata: Metadata = { title: 'Cash on delivery' };

/**
 * COD reconciliation: collected against expected, and what is still out there.
 *
 * PRD 10.1 names this as the reason the ledger earns its place - "money arrives
 * days after the order, sometimes partially, sometimes never. A `cod_receivable`
 * account tracks the gap between delivered and collected, and the
 * reconciliation dashboard reads straight off it."
 *
 * THREE NUMBERS, and they always agree with the rows beneath them. A dashboard
 * whose total does not equal its list is worse than no dashboard, so the API
 * computes all three from one query and an e2e test asserts they reconcile.
 *
 * Only DELIVERED orders count. An undelivered COD order is not outstanding
 * cash, it is an undelivered order, and mixing the two makes the number useless
 * for the question it exists to answer: how much are couriers holding.
 */
export default async function CodPage(): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/seller/cod');

  const org = await activeOrg();
  if (org === null) {
    return (
      <div className="py-10">
        <h1 className="text-xl font-semibold">Cash on delivery</h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          You are not a member of a selling organisation yet.
        </p>
      </div>
    );
  }

  const summary = await apiGet(endpoints.codSummary(), { auth: true, tenantId: org.id });
  const outstanding = summary.rows.filter((row) => row.collected === null);
  const collected = summary.rows.filter((row) => row.collected !== null);

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold">Cash on delivery</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        What couriers owe you for delivered orders, and what they have handed back.
      </p>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <Figure label="Expected" value={formatMoney(summary.expected)} />
        <Figure label="Collected" value={formatMoney(summary.collected)} />
        <Figure
          label="Outstanding"
          value={formatMoney(summary.outstanding)}
          /* `warn`, the token for "not an error but it changes what you can do".
             Money a courier is holding is exactly that: nothing has gone wrong
             yet, and it is the number worth looking at. */
          tone={summary.outstanding.amount > 0 ? 'warn' : 'neutral'}
        />
      </dl>

      <section className="mt-10">
        <h2 className="text-base font-semibold">Waiting to be collected</h2>
        {outstanding.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing outstanding. Every delivered cash order has been reconciled.
          </p>
        ) : (
          <Table rows={outstanding} tenantId={org.id} collectable />
        )}
      </section>

      {collected.length > 0 && (
        <section className="mt-10">
          <h2 className="text-base font-semibold">Collected</h2>
          <Table rows={collected} tenantId={org.id} collectable={false} />
        </section>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warn';
}): ReactNode {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold tabular ${tone === 'warn' ? 'text-warn' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Table({
  rows,
  tenantId,
  collectable,
}: {
  rows: CodRow[];
  tenantId: string;
  collectable: boolean;
}): ReactNode {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-sunk text-left">
            <th scope="col" className="px-3 py-2 font-medium">
              Order
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Expected
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Collected
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {collectable ? 'Record collection' : 'Shortfall'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shortfall = row.expected.amount - (row.collected?.amount ?? 0);
            return (
              <tr key={row.orderId} className="border-b align-middle">
                <td className="px-3 py-2.5">
                  <Link
                    href={`/seller/orders/${row.orderId}`}
                    className="font-mono underline-offset-4 hover:underline"
                  >
                    {row.orderNumber}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right tabular">{formatMoney(row.expected)}</td>
                <td className="px-3 py-2.5 text-right tabular">
                  {row.collected === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatMoney(row.collected)
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {collectable ? (
                    <CollectCodForm
                      tenantId={tenantId}
                      orderId={row.orderId}
                      expectedMinor={row.expected.amount}
                      currency={row.expected.currency}
                    />
                  ) : shortfall > 0 ? (
                    /* A courier who came back short. The gap sits in
                       COD_RECEIVABLE rather than being written off, which is
                       what makes it visible here at all. */
                    <span className="tabular text-warn">
                      {formatMoney({ amount: shortfall, currency: row.expected.currency })} short
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Settled in full</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
