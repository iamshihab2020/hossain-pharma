import { expect, type Page } from '@playwright/test';

export type Actor = { email: string; password: string };

/**
 * Namespaced per call.
 *
 * `users.email` is globally unique and the seeded database persists for the
 * whole run, so a fixed address is a 409 the second time any journey runs -
 * green alone, red in the suite. The API's own e2e suite has the same rule for
 * the same reason.
 */
export function ns(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Registers a buyer through the actual form.
 *
 * Through the UI rather than the API on purpose: this is the one place the
 * registration screen gets exercised, and a journey that seeded its user
 * through HTTP would never notice the form breaking.
 */
export async function registerBuyer(page: Page, label: string): Promise<Actor> {
  const actor: Actor = { email: `${ns(label)}@example.test`, password: 'e2e-password-1' };

  await page.goto('/register');
  await page.getByLabel('Your name').fill('E2E Buyer');
  await page.getByLabel('Email').fill(actor.email);
  await page.getByLabel('Password').fill(actor.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).not.toHaveURL(/\/register/);
  return actor;
}

export async function signIn(page: Page, actor: Actor): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(actor.email);
  await page.getByLabel('Password').fill(actor.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).not.toHaveURL(/\/signin/);
}

/**
 * Fills the checkout address form with the values the API suite also uses.
 *
 * Same address everywhere means a failure is about the form rather than about
 * which postcode someone invented this time.
 */
export async function fillAddress(page: Page): Promise<void> {
  await page.getByLabel('Full name').fill('E2E Buyer');
  await page.getByLabel('Phone').fill('+8801700000000');
  await page.getByLabel('Address', { exact: true }).fill('12 Elephant Road');
  await page.getByLabel('City').fill('Dhaka');
  await page.getByLabel('District').fill('Dhaka');
  await page.getByLabel('Postcode').fill('1205');
  await page.getByRole('button', { name: 'Save address' }).click();

  // The checkout page renders the address FORM until an address exists, and the
  // payment panel only afterwards. Waiting for the panel is what separates
  // "the address saved" from "the click did nothing".
  await expect(page.getByRole('button', { name: /place order|pay and place order/i })).toBeVisible();
}
