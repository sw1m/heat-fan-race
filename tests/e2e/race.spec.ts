import { test, expect } from '@playwright/test';

test('a solo player can fill the grid with AI drivers and start a local test race', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Nickname').fill('Preview Driver');
  await page.getByRole('button', { name: 'Yellow car' }).click();
  await expect(page.getByRole('button', { name: 'Yellow car' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'CREATE RACE' }).click();
  await expect(page.getByText('Choose your seat.')).toBeVisible();
  await page.getByRole('button', { name: 'ADD AI PLAYER' }).click();
  await expect(page.getByText('Bot 2')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Bot 2' }).click();
  await expect(page.getByText('Bot 2')).toHaveCount(0);
  await page.getByRole('button', { name: 'FILL OPEN SLOTS WITH AI' }).click();
  await expect(page.getByText('Bot 2')).toBeVisible();
  await expect(page.getByText('Bot 6')).toBeVisible();
  await expect(page.getByText('AI DRIVER · READY')).toHaveCount(5);
  await expect(page.locator('.room-share')).toBeVisible();
  await page.getByRole('button', { name: 'START RACE' }).click();
  await expect(page.getByText('YOUR DASHBOARD')).toBeVisible();
  await expect(page.locator('.stand-name', { hasText: 'Bot 2' })).toBeVisible();
  await expect(page.locator('.stand-stats')).toHaveCount(6);
  await expect(page.locator('.stand-stats').first()).toContainText('/7');
  await expect(page.locator('.stand-stats').first()).toContainText('G1');
  await expect(page.getByText('HEAT AVAILABLE', { exact: true })).toBeVisible();
  await expect(page.getByText('🔥 7/7', { exact: true })).toBeVisible();
  await expect(page.getByText('EXTRA DECK HEAT', { exact: true })).toBeVisible();
  await expect(page.getByText('+1', { exact: true })).toBeVisible();
  await expect(page.getByTestId('starter-heat-status')).toContainText(
    /STARTER HEAT: (IN HAND|IN DRAW PILE)/,
  );
  await expect(page.getByRole('button', { name: 'NUMERICAL' })).toHaveClass(/sort-selected/);
  await expect(page.locator('.stand-car')).toHaveCount(6);
  await expect(page.locator('.car-marker')).toHaveCount(6);
  const carMarkers = await page.locator('.stand-car .car-token').evaluateAll((elements) => ({
    sources: [...new Set(elements.map((element) => element.getAttribute('src')))],
    filters: [...new Set(elements.map((element) => getComputedStyle(element).filter))],
  }));
  expect(carMarkers.sources).toHaveLength(1);
  expect(carMarkers.filters).toHaveLength(6);
  expect(carMarkers.filters.some((filter) => filter.includes('sepia'))).toBe(true);
  const trackCarMarkers = await page.locator('.car-marker').evaluateAll((elements) => ({
    sources: [...new Set(elements.map((element) => element.getAttribute('src')))],
    filters: [...new Set(elements.map((element) => getComputedStyle(element).filter))],
  }));
  expect(trackCarMarkers.sources).toHaveLength(1);
  expect(trackCarMarkers.filters).toHaveLength(6);
  await page.getByRole('button', { name: /SHIFT/ }).click();
  await expect(page.getByText('1. Shift and choose cards')).toBeVisible();
  await page.locator('.log-group').first().locator('summary').click();
  await expect(page.locator('.log-group').first().locator('.log-entry')).toHaveCount(1);
  await expect(page.getByText(/Bot 2 locked in/)).toHaveCount(0);
  await page.locator('.hand-panel .card-number').first().click();
  await page.getByRole('button', { name: 'LOCK IN PLAN' }).click();
  await expect(page.getByText(/Bot 2 locked in/).first()).toBeVisible();
  await page.locator('.hand-panel .card-number').first().click();
  await expect(page.getByRole('button', { name: 'DISCARD 1 + END TURN' })).toBeVisible();
  await page.getByRole('button', { name: 'DISCARD 1 + END TURN' }).click();
  await expect(page.getByText(/Round 2:/).first()).toBeVisible();
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

test('can submit the first plan after starting a new local race from results', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Nickname').fill('Restart Tester');
  await page.getByRole('button', { name: 'CREATE RACE' }).click();
  await page.getByRole('button', { name: 'FILL OPEN SLOTS WITH AI' }).click();
  await page.getByRole('button', { name: 'START RACE' }).click();
  await expect(page.getByText('YOUR DASHBOARD')).toBeVisible();

  await page.evaluate(() => {
    const key = 'heat-fan-local-room';
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Local room was not persisted.');
    const room = JSON.parse(raw) as {
      status: string;
      game: { phase: string; winnerId: string | null; players: Array<Record<string, unknown>> };
    };
    room.status = 'FINISHED';
    room.game.phase = 'FINISHED';
    room.game.winnerId = String(room.game.players[0].id);
    room.game.players = room.game.players.map((player, index) => ({
      ...player,
      finished: true,
      finishRank: index + 1,
      finishProgress: 41 - index,
      finishRound: 1,
      position: {
        ...(player.position as { space: number; lane: number }),
        space: 41 - index,
      },
    }));
    window.localStorage.setItem(key, JSON.stringify(room));
  });
  await page.reload();
  await expect(page.getByText('CHECKERED FLAG')).toBeVisible();
  await expect(page.getByText(/FINISH S41/).first()).toBeVisible();
  await page.getByRole('button', { name: 'REVIEW RACE' }).click();
  await expect(page.getByText('RACE REVIEW')).toBeVisible();
  await page.getByRole('button', { name: 'NEW RACE' }).click();
  await expect(page.getByText('ROUND 1')).toBeVisible();

  await page.locator('.hand-panel .card-number').first().click();
  const lockButton = page.getByRole('button', { name: 'LOCK IN PLAN' });
  await expect(lockButton).toBeEnabled();
  await lockButton.click();
  await expect(page.getByText('PLAYER REACTION', { exact: true })).toBeVisible();
  await expect(page.locator('.stand-row').filter({ hasText: /Bot/ })).toHaveCount(5);
  await expect(page.locator('.stand-row').filter({ hasText: /Bot/ }).first()).toContainText(
    /G[1-4]/,
  );
  await expect(page.getByRole('button', { name: 'KEEP HAND + END TURN' })).toBeVisible();
  await page.getByRole('button', { name: 'KEEP HAND + END TURN' }).click();
  await expect(page.getByText('ROUND 2', { exact: true })).toBeVisible();
});

test('can restart after reviewing an actually completed local race', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?fresh=actual-restart');
  await page.getByLabel('Nickname').fill('Actual Finish Tester');
  await page.getByRole('button', { name: 'CREATE RACE' }).click();
  await page.getByRole('button', { name: 'ADD AI PLAYER' }).click();
  await page.getByRole('button', { name: 'START RACE' }).click();

  for (let turn = 0; turn < 45; turn += 1) {
    const planning = page.getByText('PLANNING', { exact: true });
    if (await planning.isVisible()) {
      const gearText = await page.locator('.metric').filter({ hasText: 'GEAR' }).innerText();
      const currentGear = Number(gearText.match(/\d/)?.[0] ?? 1);
      const targetGear = Math.max(1, currentGear - 1);
      await page.getByRole('button', { name: String(targetGear), exact: true }).click();
      const playableCards = page.locator(
        '.hand-panel .card:not(.card-heat):not(.card-starting_heat)',
      );
      for (let card = 0; card < targetGear; card += 1) await playableCards.nth(card).click();
      await page.getByRole('button', { name: 'LOCK IN PLAN' }).click();
    }

    for (let reaction = 0; reaction < 3; reaction += 1) {
      const skipAdrenaline = page.getByRole('button', { name: 'SKIP ADRENALINE' });
      if (await skipAdrenaline.isVisible()) {
        await skipAdrenaline.click();
        continue;
      }
      const pass = page.getByRole('button', { name: 'KEEP HAND + END TURN' });
      if (await pass.isVisible()) await pass.click();
      break;
    }
    if (await page.getByText('CHECKERED FLAG', { exact: true }).isVisible()) break;
    await page.waitForTimeout(50);
  }

  await expect(page.getByText('CHECKERED FLAG', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'REVIEW RACE' }).click();
  await expect(page.getByText('RACE REVIEW', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'NEW RACE' }).click();
  await expect(page.getByText('ROUND 1', { exact: true })).toBeVisible();

  const firstCard = page.locator('.hand-panel .card').first();
  await firstCard.click();
  await page.getByRole('button', { name: 'LOCK IN PLAN' }).click();
  await expect(page.getByText('PLAYER REACTION', { exact: true })).toBeVisible();
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
