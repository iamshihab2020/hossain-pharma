import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { endpoints, type Warehouse } from '@nexmarket/api-client';
import { apiGet, isSignedIn } from '@/lib/api/server';
import { activeOrg } from '@/lib/api/queries';
import { WarehouseForm } from '@/components/warehouse-form';
import { plural } from '@/lib/format';

export const metadata: Metadata = { title: 'Warehouses' };

/**
 * Where a seller keeps stock, and the order the allocator picks them in.
 *
 * PRD 9.2's onboarding step 5 asked for "at least one pickup location with
 * pincode" back in Phase 1 and got a name and a pincode. This is where the rest
 * of the address earns its place: Phase 6 dispatches FROM these buildings, the
 * packing slip prints one as a return address, and the courier is handed an
 * origin.
 *
 * A TABLE, not cards. Console density: the seller is comparing rows - which one
 * holds what, which one goes first - and a card deck makes that comparison a
 * scroll.
 */
export default async function WarehousesPage(): Promise<ReactNode> {
  if (!(await isSignedIn())) redirect('/signin?next=/seller/warehouses');

  const org = await activeOrg();
  if (org === null) {
    return (
      <div className="py-10">
        <h1 className="text-xl font-semibold">Warehouses</h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          You are not a member of a selling organisation yet. Once you are, the places you
          keep stock are listed here.
        </p>
      </div>
    );
  }

  const { items } = await apiGet(endpoints.warehouses(), { auth: true, tenantId: org.id });

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold">Warehouses</h1>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Orders are filled from these in priority order, lowest first. A line that one
        building cannot fill is split across the next.
      </p>

      {items.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No warehouses yet. Add the place your stock is kept and orders will dispatch from
          it.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-sunk text-left">
                <Th className="w-12 text-right">#</Th>
                <Th>Location</Th>
                <Th>Address</Th>
                <Th className="text-right">Listings</Th>
                <Th className="text-right">Units</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((warehouse) => (
                <Row key={warehouse.id} warehouse={warehouse} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-10 max-w-xl">
        <h2 className="text-base font-semibold">Add a warehouse</h2>
        <WarehouseForm tenantId={org.id} />
      </section>
    </div>
  );
}

function Row({ warehouse }: { warehouse: Warehouse }): ReactNode {
  return (
    <tr className="border-b align-top">
      {/* Right-aligned and tabular, like every number in this system. */}
      <Td className="text-right tabular text-muted-foreground">{warehouse.priority}</Td>
      <Td>
        <span className="font-medium">{warehouse.name}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {warehouse.isDefault && <span>Default</span>}
          {warehouse.isPickupPoint && <span>Buyers can collect here</span>}
        </span>
      </Td>
      <Td className="text-muted-foreground">
        {warehouse.addressLine === '' ? (
          /* Phase 2 stored a pincode alone, so rows predating Phase 6 have no
             street. Saying so is better than printing an empty cell onto a
             packing slip. */
          <span className="text-warn">No street address yet</span>
        ) : (
          <>
            {warehouse.addressLine}, {warehouse.city}
          </>
        )}
        <span className="mt-0.5 block font-mono text-xs">
          {warehouse.postcode} · {warehouse.countryCode}
        </span>
      </Td>
      <Td className="text-right tabular">{warehouse.listingCount}</Td>
      <Td className="text-right tabular">
        {warehouse.unitsOnHand}
        <span className="sr-only"> {plural(warehouse.unitsOnHand, 'unit', 'units')}</span>
      </Td>
    </tr>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <th scope="col" className={`px-3 py-2 font-medium ${className ?? ''}`}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <td className={`px-3 py-2.5 ${className ?? ''}`}>{children}</td>;
}
