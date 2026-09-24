import { expect, test } from '@playwright/test';

/**
 * Browser test of the workspace flow. Requires a running server and
 * `npx playwright install chromium`.
 */
test('demo dataset loads, answers a question and exposes SQL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('InsightLab', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Load demo dataset' }).click();
  await expect(page.getByText('Dataset ready')).toBeVisible({ timeout: 20_000 });

  // Suggested questions are derived from the detected schema.
  const suggestion = page.getByRole('button', { name: /changed over time/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  await expect(page.getByText(/In this dataset, revenue moved from/)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Question').fill('Which category has the highest profit?');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByText(/leads on total profit/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('How has revenue changed over time?', { exact: true })).toBeVisible();
  await expect(page.getByText('Which category has the highest profit?', { exact: true })).toHaveCount(2);

  await page.getByRole('tab', { name: 'SQL' }).click();
  await expect(page.locator('pre')).toContainText('SELECT');

  await page.getByRole('tab', { name: 'Trace' }).click();
  await expect(page.getByText('execute_read_only_sql')).toBeVisible();
});

test('an off-topic question is refused rather than answered', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load demo dataset' }).click();
  await expect(page.getByText('Dataset ready')).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('Question').fill('What is the weather forecast for Tirana?');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByText(/cannot be answered from the available columns/)).toBeVisible({ timeout: 30_000 });
});
