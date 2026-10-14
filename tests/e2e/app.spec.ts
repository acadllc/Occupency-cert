import { expect, test, type Page } from '@playwright/test';

// Runs against the VITE_DATA_MODE=mock build (in-browser data store, test login).
const EMAIL = 'test@acad.local';
const PASSWORD = 'test-password-123';

async function login(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('rejects wrong credentials with a generic message', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign-in failed. Check the email address and password.');
  // protected routes redirect to login
  await page.goto('./#/projects');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('full workflow: create, generate, download, history, edit, search', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  // ---- create a project (Arabic + English entered separately)
  await page.getByRole('link', { name: '＋ New project' }).first().click();
  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
  await page.getByLabel('Project ID').fill('B2N-2026-000777');
  await page.getByLabel(/Owner name \(Arabic\)/).fill('سالم خليفة راشد المنصوري');
  await page.getByLabel('Owner name (English)').fill('Salem Khalifa Al Mansouri');
  await page.getByLabel(/Contractor name \(Arabic\)/).fill('مؤسسة البناء الحديث للمقاولات');
  await page.getByLabel('Contractor name (English)').fill('Modern Building Contracting Est.');
  await page.getByLabel(/^City/).selectOption('abu_dhabi');
  await page.getByLabel(/Area \/ zone \(Arabic\)/).fill('السعادة');
  await page.getByLabel('Area / zone (English)').fill('Al Saadah');
  await page.getByLabel(/Sector \(Arabic\)/).fill('شرق 41');
  await page.getByLabel('Sector (English)').fill('East 41');
  await page.getByLabel(/Plot number/).fill('007');
  await page.getByLabel(/Project components \(Arabic\)/).fill('فيلا دورين + سور خارجي');
  // the derived Arabic location updates live
  await expect(page.getByText('أبوظبي / السعادة / شرق 41 - 007')).toBeVisible();

  await page.getByRole('button', { name: 'Create project' }).first().click();
  await expect(page.getByText('Project created')).toBeVisible();
  await expect(page).toHaveURL(/#\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'B2N-2026-000777' })).toBeVisible();

  // ---- document-specific fields appear only when the document is selected
  await expect(page.getByText('Mechanical – authorization type')).toHaveCount(0);
  await page.getByText('Number of Users Letter').click();
  await page.getByText('Commitment – Testing & Commissioning of Mechanical Systems').click();
  await expect(page.getByText('Mechanical – authorization type')).toBeVisible();
  await page.locator('label.chip', { hasText: 'Supply' }).first().click();

  // ---- generate: warn about empty fields but allow continuing
  await page.getByRole('button', { name: 'Save & generate PDFs' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Check before generating' })).toBeVisible();
  await expect(dialog.getByText('Project description (English)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue with blanks' }).click();
  await expect(dialog.getByText('All documents were generated and saved privately.')).toBeVisible({ timeout: 60_000 });

  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).first().click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^B2N-2026-000777_[a-z-]+_\d{8}-\d{6}_r2\.pdf$/);
  const pdfPath = await file.path();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(pdfPath!).subarray(0, 5).toString()).toBe('%PDF-');

  const zipDl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Download ZIP \(2\)/ }).click();
  expect((await zipDl).suggestedFilename()).toBe('B2N-2026-000777_documents_r2.zip');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // ---- history keeps the immutable files
  await page.getByRole('tab', { name: 'Generated documents' }).click();
  await expect(page.getByText('2 of 2 documents')).toBeVisible();
  const histDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  expect((await histDl).suggestedFilename()).toMatch(/\.pdf$/);

  // ---- edit creates a new revision
  await page.getByRole('tab', { name: 'Details & documents' }).click();
  await page.getByLabel('Owner name (English)').fill('Salem K. Al Mansouri');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved (revision 3)')).toBeVisible();

  // ---- generate ALL templates in the browser
  await page.getByRole('button', { name: /Select all \(18\)/ }).click();
  await page.getByRole('button', { name: 'Save & generate PDFs' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue with blanks' }).click();
  await expect(page.getByRole('dialog').getByText('All documents were generated and saved privately.')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('dialog').locator('.progress-item')).toHaveCount(18);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  // ---- search by Arabic owner name and by plot number
  await page.getByRole('navigation').getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByLabel('Search projects').fill('المنصوري');
  await expect(page.getByRole('link', { name: 'B2N-2026-000777' })).toBeVisible();
  await page.getByLabel('Search projects').fill('nothing-matches-this');
  await expect(page.getByText('No matching projects')).toBeVisible();
  await page.getByLabel('Search projects').fill('007');
  await expect(page.getByRole('link', { name: 'B2N-2026-000777' })).toBeVisible();

  // ---- dashboard reflects the work
  await page.getByRole('navigation').getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.locator('.stat', { hasText: 'Documents generated' }).locator('.value')).toHaveText('20');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);
});
