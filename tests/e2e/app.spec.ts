import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  // ---- stamp & signature are uploaded once in Settings (private storage; fictional test image)
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('No stamp and signature uploaded yet')).toBeVisible();
  await page.getByLabel('Stamp and signature image').setInputFiles(fileURLToPath(new URL('../fixtures/test-stamp.png', import.meta.url)));
  await expect(page.getByText('Stamp and signature saved')).toBeVisible();
  await expect(page.getByAltText('Current stamp and signature')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Dashboard' }).click();

  // ---- create a project
  await page.getByRole('link', { name: '＋ New project' }).first().click();
  await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();

  // ---- start from a site plan: the PDF is read in the browser and fills the fields
  await page.getByLabel('Site plan PDF').setInputFiles(fileURLToPath(new URL('../fixtures/siteplan-sample.pdf', import.meta.url)));
  const sp = page.getByRole('dialog', { name: 'Details found in the site plan' });
  await expect(sp.getByText('18-7-200-047')).toBeVisible({ timeout: 30_000 });
  await expect(sp.getByText('سالم خليفة راشد سالم المنصوري')).toBeVisible();
  await sp.getByRole('button', { name: 'Fill selected fields' }).click();
  await expect(page.getByLabel('Area / zone (English)')).toHaveValue('Central District');
  await expect(page.getByLabel(/Sector \(Arabic\)/)).toHaveValue('حي الحميرة');
  await expect(page.getByLabel('Owner name (English)')).toHaveValue('Salem Khalifa Rashed Salem Almansoori');
  await expect(page.getByText('العين / وسط المدينة / حي الحميرة - 18-7-200-047')).toBeVisible();

  // ---- manual entry (Arabic + English entered separately) overrides imported values
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
  await page.getByRole('button', { name: 'Save & generate' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Generate documents' })).toBeVisible();
  await expect(dialog.getByText('Project description (English)')).toBeVisible();
  // Word output with the company stamp; the official mechanical form stays PDF
  await dialog.getByText('Word (.docx)').click();
  await expect(dialog.getByText(/only available as PDF/)).toBeVisible();
  await expect(dialog.getByLabel('Add the ACAD stamp & signature')).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue with blanks' }).click();
  await expect(dialog.getByText('All documents were generated and saved privately.')).toBeVisible({ timeout: 60_000 });

  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).first().click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^B2N-2026-000777_number-of-users_\d{8}-\d{6}_r2\.docx$/);
  expect(readFileSync((await file.path())!).subarray(0, 2).toString()).toBe('PK');
  const pdfDl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).nth(1).click();
  const pdf = await pdfDl;
  expect(pdf.suggestedFilename()).toMatch(/^B2N-2026-000777_mechanical-commitment_\d{8}-\d{6}_r2\.pdf$/);
  expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe('%PDF-');

  const zipDl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Download ZIP \(2\)/ }).click();
  expect((await zipDl).suggestedFilename()).toBe('B2N-2026-000777_documents_r2.zip');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // ---- history keeps the immutable files
  await page.getByRole('tab', { name: 'Generated documents' }).click();
  await expect(page.getByText('2 of 2 documents')).toBeVisible();
  const histDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  expect((await histDl).suggestedFilename()).toMatch(/\.(pdf|docx)$/);
  await expect(page.locator('.badge', { hasText: 'Word' })).toHaveCount(1);

  // ---- edit creates a new revision
  await page.getByRole('tab', { name: 'Details & documents' }).click();
  await page.getByLabel('Owner name (English)').fill('Salem K. Al Mansouri');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved (revision 3)')).toBeVisible();

  // ---- generate ALL templates in the browser
  await page.getByRole('button', { name: /Select all \(18\)/ }).click();
  await page.getByRole('button', { name: 'Save & generate' }).click();
  await page.getByRole('dialog').getByText('PDF', { exact: true }).click();
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
