'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { createAddress, type AddressState } from '@/app/actions/checkout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIAL: AddressState = { error: null, fieldErrors: {} };

/**
 * The address form.
 *
 * Validated against the API's own zod schema, imported through
 * `@nexmarket/api-client` - so "postcode must be four digits" is one rule in
 * one place rather than a client rule that drifts from the server's. The server
 * still validates; this only means the buyer hears about it sooner.
 */
export function AddressForm(): ReactNode {
  const [state, formAction] = useActionState(createAddress, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Field
        name="recipientName"
        label="Full name"
        autoComplete="name"
        error={state.fieldErrors['recipientName']}
        required
      />
      <Field
        name="phone"
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+8801700000000"
        error={state.fieldErrors['phone']}
        required
      />
      <Field
        name="line1"
        label="Address"
        autoComplete="address-line1"
        error={state.fieldErrors['line1']}
        required
      />
      <Field
        name="line2"
        label="Apartment, floor (optional)"
        autoComplete="address-line2"
        error={state.fieldErrors['line2']}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="city"
          label="City"
          autoComplete="address-level2"
          error={state.fieldErrors['city']}
          required
        />
        <Field
          name="district"
          label="District"
          autoComplete="address-level1"
          error={state.fieldErrors['district']}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="postcode"
          label="Postcode"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="1205"
          error={state.fieldErrors['postcode']}
          required
        />
        <Field
          name="countryCode"
          label="Country"
          defaultValue="BD"
          autoComplete="country"
          error={state.fieldErrors['countryCode']}
          required
        />
      </div>

      <SubmitButton />
    </form>
  );
}

function Field({
  name,
  label,
  error,
  ...input
}: {
  name: string;
  label: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>): ReactNode {
  const errorId = `${name}-error`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        {...input}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SubmitButton(): ReactNode {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      Save address
    </Button>
  );
}
