'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { createWarehouse } from '@/app/actions/warehouses';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Adding a place stock is kept.
 *
 * An uncontrolled form posting `FormData` to a Server Action - no per-field
 * state, because none of these fields depends on another. `warehouse-form.ts`
 * does the parsing, so what a test drives is plain values rather than a DOM.
 *
 * The address fields are REQUIRED here even though the columns have defaults in
 * the database. The defaults exist so Phase 2's rows stay valid; new buildings
 * get a real address because a packing slip prints one as a return address and
 * a courier is handed it as an origin.
 */
export function WarehouseForm({ tenantId }: { tenantId: string }): ReactNode {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(form: FormData): void {
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await createWarehouse(tenantId, form);
      if (result.ok) {
        setSaved(true);
        return;
      }
      setError(result.message);
    });
  }

  return (
    <form action={submit} className="mt-4 flex flex-col gap-4">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert className="border-success/40 bg-success-wash">
          {/* Past tense, matching the button that produced it. */}
          <AlertDescription className="text-success">Warehouse added.</AlertDescription>
        </Alert>
      )}

      <Field name="name" label="Name" placeholder="Dhaka depot" required />
      <Field name="addressLine" label="Street address" placeholder="12 Elephant Road" required />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="city" label="City" placeholder="Dhaka" required />
        <Field name="district" label="District" placeholder="Dhaka" required />
        <Field name="postcode" label="Postcode" placeholder="1205" required />
        <Field name="contactPhone" label="Contact phone" placeholder="+8801700000000" required />
      </div>

      <Field
        name="priority"
        label="Priority"
        placeholder="0"
        hint="Lowest first. Orders are filled from this building before higher numbers."
        inputMode="numeric"
      />

      <div className="flex flex-col gap-2">
        <Checkbox name="isDefault" label="Make this the default location" />
        <Checkbox
          name="isPickupPoint"
          label="Buyers can collect from here"
          hint="Shown as a pickup point at checkout."
        />
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
        Add warehouse
      </Button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  hint,
  required,
  inputMode,
}: {
  name: string;
  label: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  inputMode?: 'numeric';
}): ReactNode {
  const hintId = hint === undefined ? undefined : `${name}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        placeholder={placeholder ?? ''}
        required={required ?? false}
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(hintId === undefined ? {} : { 'aria-describedby': hintId })}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function Checkbox({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint?: string;
}): ReactNode {
  return (
    <label htmlFor={name} className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        id={name}
        name={name}
        className="mt-0.5 size-4 rounded-sm border-border accent-primary"
      />
      <span>
        {label}
        {hint !== undefined && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  );
}
