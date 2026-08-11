import { test, expect } from '@playwright/test';

test('a solo player can add a bot and start a local test race', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Nickname').fill('Preview Driver');
  await page.getByRole('button', { name: 'Blue car' }).click();
  await expect(page.getByRole('button', { name: 'Blue car' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'CREATE RACE' }).click();
  await expect(page.getByText('Choose your seat.')).toBeVisible();
  await page.getByRole('button', { name: 'ADD AI PLAYER' }).click();
  await expect(page.getByText('Bot 2')).toBeVisible();
  await expect(page.getByText('AI DRIVER · READY')).toBeVisible();
  await expect(page.locator('.room-share')).toBeVisible();
  await page.getByRole('button', { name: 'START RACE' }).click();
  await expect(page.getByText('YOUR DASHBOARD')).toBeVisible();
  await expect(page.locator('.stand-name', { hasText: 'Bot 2' })).toBeVisible();
  await expect(page.locator('.stand-car')).toHaveCount(2);
  const carStyles = await page
    .locator('.stand-car')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('style')));
  expect(new Set(carStyles).size).toBe(2);
  await page.getByRole('button', { name: /SHIFT/ }).click();
  await expect(page.getByText('1. Shift and choose cards')).toBeVisible();
  await expect(page.getByText(/Bot 2 locked in/)).toHaveCount(0);
  await page.locator('.hand-panel .card-number').first().click();
  await page.getByRole('button', { name: 'LOCK IN PLAN' }).click();
  await expect(page.getByText(/Bot 2 locked in/)).toBeVisible();
  await page.locator('.hand-panel .card-number').first().click();
  await expect(page.getByRole('button', { name: 'DISCARD 1 + END TURN' })).toBeVisible();
  await page.getByRole('button', { name: 'DISCARD 1 + END TURN' }).click();
  await expect(page.getByText(/Round 2:/)).toBeVisible();
  const leaveButton = page.getByRole('button', { name: 'LEAVE ROOM' }).first();
  const leaveButtonBox = await leaveButton.boundingBox();
  expect(leaveButtonBox).not.toBeNull();
  expect(leaveButtonBox?.x).toBeGreaterThanOrEqual(0);
  expect((leaveButtonBox?.x ?? 0) + (leaveButtonBox?.width ?? 0)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await page.getByRole('button', { name: 'LEAVE ROOM' }).first().click();
  await expect(page.getByLabel('Nickname')).toBeVisible();
  await page.reload();
  await expect(page.getByText('ENTER THE PADDOCK')).toBeVisible();
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
