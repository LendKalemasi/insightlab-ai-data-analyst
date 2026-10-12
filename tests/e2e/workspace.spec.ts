import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests of the real UI against a running server. They work in
 * either planner mode: assertions target computed results, which are the
 * same whether or not an AI key is configured.
 */

async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open demo dataset' }).click();
  await expect(page).toHaveURL(/\/datasets\/ds_[a-f0-9]{32}$/, { timeout: 30_000 });
  await expect(page.getByText('Rows', { exact: true })).toBeVisible();
}

test('demo: overview, ask a question, inspect SQL, and the conversation survives a reload', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole('heading', { name: 'Data quality' })).toBeVisible();
  await expect(page.getByText(/region is missing \d+ values/)).toBeVisible();

  await page.getByRole('navigation', { name: 'Workspace' }).first().getByRole('link', { name: 'Ask' }).click();
  await expect(page.getByRole('heading', { name: 'What would you like to know?' })).toBeVisible();
  await page.getByRole('button', { name: 'How has revenue changed over time?' }).click();
  await expect(page.getByText('Calculated from your data')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Total revenue went from [\d,]+ in 2025-01 to [\d,]+ in 2025-09/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Line chart of total revenue/ })).toBeVisible();

  await page.getByRole('tab', { name: 'SQL' }).click();
  await expect(page.locator('pre')).toContainText('SELECT substr("date", 1, 7)');

  await page.reload();
  await expect(page.getByText('How has revenue changed over time?', { exact: true })).toBeVisible();
  await expect(page.getByText('1 question · saved with this dataset')).toBeVisible();
});

test('questions the data cannot answer are declined, not invented', async ({ page }) => {
  await openDemo(page);
  await page.goto(`${page.url()}/ask`);
  const box = page.getByLabel(/Ask a question about/);
  await box.fill('What is the weather forecast for Tirana tomorrow?');
  await box.press('Enter');
  await expect(page.getByText(/Cannot answer from this data|Needs clarification/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Calculated from your data')).toHaveCount(0);
});

test('upload a CSV, browse and search the rows', async ({ page }) => {
  await page.goto('/');
  const csv = 'city,sales,day\nBremen,100,2025-01-01\nTirana,250,2025-01-02\nBremen,,2025-01-03\nOslo,75,2025-01-04\n';
  await page.locator('input[type="file"]').setInputFiles({ name: 'cities.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page).toHaveURL(/\/datasets\/ds_/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'sales', exact: true })).toBeVisible();
  await expect(page.getByText(/sales is missing 1 value/)).toBeVisible();

  await page.goto(`${page.url()}/data`);
  await expect(page.getByText('4 rows')).toBeVisible();
  await page.getByLabel('Search rows').fill('bremen');
  await expect(page.getByText('2 rows of 4')).toBeVisible();
});

test('invalid uploads explain what went wrong', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert').filter({ hasText: 'Could not import' })).toContainText('not a supported file');
  await page.locator('input[type="file"]').setInputFiles({ name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n') });
  await expect(page.getByRole('alert').filter({ hasText: 'Could not import' })).toContainText('no data rows');
});

test('the SQL editor runs SELECTs and refuses writes', async ({ page }) => {
  await openDemo(page);
  await page.goto(`${page.url()}/sql`);
  const editor = page.getByLabel('SQL query');
  await editor.fill('SELECT region, COUNT(*) AS n FROM dataset GROUP BY region');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByText(/5 rows in \d+ ms/)).toBeVisible();
  await editor.fill('DELETE FROM dataset');
  await editor.press('Control+Enter');
  await expect(page.getByText('Query failed')).toBeVisible();
});

test('mobile layout has no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ask your data a question' })).toBeVisible();
  const overflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await openDemo(page);
  expect(await page.evaluate(() => document.body.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
