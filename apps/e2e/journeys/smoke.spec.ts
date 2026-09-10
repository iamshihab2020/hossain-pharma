import { expect, test } from '@playwright/test';

/**
 * The HARNESS test, not an app test.
 *
 * It exists to fail loudly when the stack is wrong - wrong port, unseeded
 * database, web app pointed at the development API - so that a real journey
 * failing means the journey is broken rather than the plumbing underneath it.
 *
 * Deleted in Task 3, once two real journeys make the same point better.
 */
test('the API is up and the storefront renders', async ({ page, request }) => {
  const health = await request.get('http://localhost:4001/health');
  expect(health.ok()).toBe(true);

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});

test('the seed reached the database the web app is reading', async ({ page }) => {
  // A storefront with an empty catalogue looks identical to a storefront whose
  // API is pointed somewhere else. This tells them apart.
  await page.goto('/search?q=redmi');
  await expect(page.getByText(/redmi/i).first()).toBeVisible();
});
