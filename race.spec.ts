import { test, expect } from '@playwright/test';

test('landing page can create a local preview room and show the four-seat lobby', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Nickname').fill('Preview Driver');
  await page.getByRole('button', { name: 'CREATE RACE' }).click();
  await expect(page.getByText('Choose your seat.')).toBeVisible();
  await page.getByRole('button', { name: 'ADD PREVIEW SEAT' }).click();
  await expect(page.getByText('Racer 2')).toBeVisible();
  await expect(page.locator('.room-share')).toBeVisible();
});

test('two browser contexts can create, join, start, and observe a synchronized room when Supabase is configured', async ({
  browser,
}) => {
  test.skip(
    !process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY,
    'requires a configured ephemeral Supabase project',
  );
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto('/');
  await host.getByLabel('Nickname').fill('Host');
  await host.getByRole('button', { name: 'CREATE RACE' }).click();
  const code = await host.locator('.room-share strong').textContent();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await guest.goto('/');
  await guest.getByLabel('Nickname').fill('Guest');
  await guest.getByLabel('Room code or invite link').fill(code ?? '');
  await guest.getByRole('button', { name: 'JOIN RACE' }).click();
  await expect(host.getByText('Guest')).toBeVisible();
  await expect(guest.getByText('Host')).toBeVisible();
  await host.getByRole('button', { name: 'START RACE' }).click();
  await expect(host.getByText('YOUR DASHBOARD')).toBeVisible();
  await expect(guest.getByText('YOUR DASHBOARD')).toBeVisible();
  await hostContext.close();
  await guestContext.close();
});
