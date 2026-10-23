import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const modal = (page: Page) => page.getByRole('dialog');
const ENGINE = process.env.OPSDESK_DB_CLIENT ?? 'sqlite';
const ENGINE_LABEL = ({ sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL' } as Record<string, string>)[ENGINE]!;

async function addBookmark(page: Page, f: { title: string; url: string; env?: string; tags?: string; description?: string; favorite?: boolean; note?: string }) {
  await page.getByRole('button', { name: 'Add bookmark', exact: true }).first().click();
  const dlg = modal(page);
  await dlg.getByLabel('Title').fill(f.title);
  await dlg.getByLabel('URL').fill(f.url);
  if (f.description) await dlg.getByLabel('Description (optional)').fill(f.description);
  if (f.env) await dlg.getByLabel('Environment').selectOption(f.env);
  if (f.tags) await dlg.getByLabel('Tags (comma separated)').fill(f.tags);
  if (f.note) await dlg.getByLabel(/Operational note/).fill(f.note);
  if (f.favorite) await dlg.getByLabel(/Pin to the top/).check();
  await dlg.getByRole('button', { name: 'Add bookmark' }).click();
}

test('first run, bookmark lifecycle, search, persistence, import/export, backup', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const external: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:4391')) external.push(r.url()); });

  await test.step('first run: welcome screen, choose empty dashboard', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome to OpsDesk' })).toBeVisible();
    await page.getByRole('button', { name: /Start with an empty dashboard/ }).click();
    await expect(page.getByRole('heading', { name: 'No workspaces yet' })).toBeVisible();
  });

  await test.step('create workspace and group', async () => {
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await page.getByRole('button', { name: /New workspace/ }).first().click();
    await modal(page).getByLabel('Name').fill('Observability');
    await modal(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Observability', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'Create group' }).click();
    await modal(page).getByLabel('Name').fill('Elastic Stack');
    await modal(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: /Elastic Stack/, level: 3 })).toBeVisible();
  });

  await test.step('unsafe and invalid URLs are rejected with clear messages', async () => {
    await page.getByRole('button', { name: 'Add bookmark', exact: true }).first().click();
    const dlg = modal(page);
    await dlg.getByLabel('Title').fill('Evil');
    await dlg.getByLabel('URL').fill('javascript:alert(1)');
    await dlg.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: 'Only http:// and https://' })).toBeVisible();
    await dlg.getByLabel('URL').fill('https://user:secret@example.org/');
    await dlg.getByRole('button', { name: 'Add bookmark' }).click();
    await expect(dlg.getByText(/must not contain a user name or password/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('add bookmarks (internal host + port + fragment, HTML-like text)', async () => {
    await addBookmark(page, { title: 'Kibana', url: 'http://kibana-prod.corp.local:5601/app/discover#/?_g=(x:1)', env: 'production', tags: 'elastic, logs', description: 'Log search', favorite: true, note: 'Use ops-logs-*' });
    await addBookmark(page, { title: 'Kibana Preprod', url: 'https://kibana-pre.example.org:5601/', env: 'preproduction', tags: 'elastic' });
    await addBookmark(page, { title: '<img src=x onerror=alert(1)>Grafana', url: 'https://grafana.example.org/', env: 'staging', tags: 'metrics', description: '<script>alert(2)</script>' });
    await expect(page.locator('article.card', { hasText: 'Kibana Preprod' })).toBeVisible();
    // HTML-like content must be shown as text, never become DOM
    await expect(page.locator('article.card img[src="x"]')).toHaveCount(0);
    await expect(page.locator('article.card .card-title', { hasText: '<img src=x onerror=alert(1)>Grafana' })).toBeVisible();
    await expect(page.locator('article.card .card-desc', { hasText: '<script>alert(2)</script>' })).toBeVisible();
    // production recognisable, link opens safely in a new tab
    const prod = page.locator('article.card.card-prod', { hasText: 'Kibana' }).first();
    await expect(prod.locator('.env-production')).toBeVisible();
    const link = prod.getByRole('link', { name: /Kibana/ });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
    // pinned section shows the favorite
    await expect(page.locator('section[aria-labelledby="sec-pinned"] article')).toHaveCount(1);
  });

  await test.step('search, scope, filters work together', async () => {
    const search = page.getByRole('searchbox');
    await search.fill('KIBANA');
    await expect(page.getByRole('status').filter({ hasText: '2 results' })).toBeVisible();
    await page.getByRole('button', { name: 'Environment' }).click();
    await page.getByRole('checkbox', { name: /Production/ }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').filter({ hasText: '1 result' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 results' })).toBeVisible();
    await page.getByRole('button', { name: 'Tags' }).click();
    await page.getByRole('checkbox', { name: /logs/ }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').filter({ hasText: '1 result' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('button', { name: 'Reset search' }).click();
    await expect(search).toHaveValue('');
    await search.fill('does-not-exist');
    await expect(page.getByRole('heading', { name: 'No bookmarks match' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset search' }).first().click();
    await page.getByRole('button', { name: 'Favorites' }).click();
    await expect(page.locator('article.card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Favorites' }).click();
    await expect(page.locator('article.card')).toHaveCount(4); // 1 pinned (duplicate view) + 3 in the group
  });

  await test.step('edit, duplicate, move earlier, delete with confirmation', async () => {
    const card = page.locator('section[aria-labelledby^="group-"] article.card', { hasText: 'Kibana Preprod' });
    await card.hover();
    await card.getByRole('button', { name: /Actions for Kibana Preprod/ }).click();
    await page.getByRole('menuitem', { name: 'Edit...' }).click();
    await modal(page).getByLabel('Title').fill('Kibana Pre-production');
    await modal(page).getByRole('button', { name: 'Save changes' }).click();
    const edited = page.locator('section[aria-labelledby^="group-"] article.card', { hasText: 'Kibana Pre-production' });
    await expect(edited).toBeVisible();

    await edited.hover();
    await edited.getByRole('button', { name: /Actions for Kibana Pre-production/ }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.locator('article.card', { hasText: 'Kibana Pre-production (copy)' })).toBeVisible();

    const titlesOf = () => page.locator('section[aria-labelledby^="group-"] .card-title').allTextContents();
    expect(await titlesOf()).toEqual(['Kibana', 'Kibana Pre-production', 'Kibana Pre-production (copy)', '<img src=x onerror=alert(1)>Grafana']);
    const copy = page.locator('section[aria-labelledby^="group-"] article.card', { hasText: '(copy)' });
    await copy.hover();
    await copy.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Move earlier' }).click();
    await expect.poll(titlesOf).toEqual(['Kibana', 'Kibana Pre-production (copy)', 'Kibana Pre-production', '<img src=x onerror=alert(1)>Grafana']);

    await copy.hover();
    await copy.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Delete...' }).click();
    await expect(modal(page).getByRole('heading', { name: 'Delete bookmark?' })).toBeVisible();
    await modal(page).getByRole('button', { name: 'Delete bookmark' }).click();
    await expect(page.locator('article.card', { hasText: '(copy)' })).toHaveCount(0);
  });

  await test.step('move a bookmark into a new group and delete a non-empty group with "move"', async () => {
    const card = page.locator('section[aria-labelledby^="group-"] article.card', { hasText: 'Grafana' });
    await card.hover();
    await card.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit...' }).click();
    await modal(page).getByLabel('Group', { exact: true }).selectOption('__new__');
    await modal(page).getByLabel('New group name').fill('Metrics');
    await modal(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: /Metrics/, level: 3 })).toBeVisible();

    await page.getByRole('button', { name: 'Actions for group Metrics' }).click();
    await page.getByRole('menuitem', { name: 'Delete group...' }).click();
    await expect(modal(page).getByText(/contains 1 bookmark/)).toBeVisible();
    await modal(page).getByRole('button', { name: /Move, then delete group/ }).click();
    await expect(page.getByRole('heading', { name: /Metrics/, level: 3 })).toHaveCount(0);
    await expect(page.locator('section[aria-labelledby^="group-"] article.card', { hasText: 'Grafana' })).toBeVisible();
  });

  await test.step('command palette opens with Ctrl+K and launches a bookmark; recents recorded', async () => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', { name: /Search bookmarks/ })).toBeFocused();
    await page.keyboard.type('pre-production');
    await expect(page.getByRole('option').first()).toContainText('Kibana Pre-production');
    const popupPromise = page.context().waitForEvent('page');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.close().catch(() => undefined);
    await expect(page.locator('section[aria-labelledby="sec-recent"] article')).toHaveCount(1);
    await expect(page.locator('section[aria-labelledby="sec-recent"] article')).toContainText('Kibana Pre-production');
  });

  await test.step('keyboard: "/" focuses search; arrow keys move between cards', async () => {
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox')).toBeFocused();
    const first = page.locator('section[aria-labelledby^="group-"] a[data-nav]').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('section[aria-labelledby^="group-"] a[data-nav]').nth(1)).toBeFocused();
  });

  await test.step('theme and layout toggles', async () => {
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Switch to compact layout' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-density', 'compact');
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Switch to comfortable layout' }).click();
  });

  await test.step('data survives a page reload', async () => {
    await page.reload();
    await expect(page.locator('section[aria-labelledby^="group-"] article.card')).toHaveCount(3);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  await test.step('settings: data directory, secrets reminder, backup, export', async () => {
    await page.getByRole('link', { name: /Settings, data and backups/ }).click();
    await expect(page.getByTestId('data-dir')).toContainText('e2e-data');
    await expect(page.getByTestId('db-engine')).toContainText(ENGINE_LABEL);
    await expect(page.getByTestId('db-engine')).toContainText('read-only');
    await expect(page.getByText('Keep secrets out of bookmarks')).toBeVisible();
    if (ENGINE === 'sqlite') {
      await page.getByRole('button', { name: 'Create backup now' }).click();
      await expect(page.getByRole('cell', { name: /^manual-.*\.sqlite$/ })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'Create backup now' })).toHaveCount(0);
      await expect(page.getByText(/made with your database tooling/)).toBeVisible();
    }
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export JSON' }).click()]);
    mkdirSync('test-results', { recursive: true });
    await download.saveAs('test-results/export.json');
    const exp = JSON.parse(readFileSync('test-results/export.json', 'utf8'));
    expect(exp.format).toBe('opsdesk-export');
    expect(exp.workspaces[0].groups[0].bookmarks.map((b: { title: string }) => b.title)).toEqual(['Kibana', 'Kibana Pre-production', '<img src=x onerror=alert(1)>Grafana']);
  });

  await test.step('import preview (merge) shows duplicates and applies nothing until confirmed', async () => {
    writeFileSync('test-results/merge.json', JSON.stringify({
      format: 'opsdesk-export', version: 1,
      workspaces: [{ name: 'observability', groups: [{ name: 'elastic stack', bookmarks: [
        { title: 'Kibana again', url: 'http://kibana-prod.corp.local:5601/app/discover#/?_g=(x:1)' },
        { title: 'APM', url: 'https://apm.example.org/' }] }] }],
    }));
    await page.getByLabel(/File \(\.json or \.html/).setInputFiles('test-results/merge.json');
    await expect(page.getByText(/1 duplicate\(s\) skipped/)).toBeVisible();
    await expect(page.getByText(/1 bookmark\(s\) added/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/Import complete/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible(); // lands on workspace selection
    await page.getByRole('link', { name: 'Open workspace Observability' }).click();
    await expect(page.locator('article.card', { hasText: 'APM' })).toBeVisible();
    await expect(page.locator('article.card', { hasText: 'Kibana again' })).toHaveCount(0);
  });

  await test.step('invalid import is rejected and data stays intact', async () => {
    await page.getByRole('link', { name: /Settings, data and backups/ }).click();
    writeFileSync('test-results/bad.json', JSON.stringify({ format: 'opsdesk-export', version: 1, workspaces: [{ name: 'X', groups: [{ name: 'G', bookmarks: [{ title: 'bad', url: 'javascript:alert(1)' }] }] }] }));
    await page.getByLabel(/File \(\.json or \.html/).setInputFiles('test-results/bad.json');
    await expect(page.getByRole('alert').filter({ hasText: /http/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  });

  await test.step('cross-origin write attempt from the browser context is rejected', async () => {
    const res = await request.post('/api/workspaces', { data: { name: 'Evil' }, headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' } });
    expect(res.status()).toBe(403);
  });

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
  expect(external, 'no requests leave the local server').toEqual([]);
});

test('drag and drop reorders bookmarks and groups, and the order persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open workspace Observability' }).click();
  const group = page.locator('section[aria-labelledby^="group-"]').first();
  const titles = () => group.locator('.card-title').allTextContents();
  await expect(group.locator('article.card').first()).toBeVisible();
  const before = await titles();
  expect(before.length).toBeGreaterThanOrEqual(3);
  const last = group.locator('article.card').last();
  const first = group.locator('article.card').first();
  await last.dragTo(first, { targetPosition: { x: 20, y: 10 } });
  await expect.poll(titles).toEqual([before[before.length - 1], ...before.slice(0, -1)]);

  // create a second group, then drag it above the first
  await page.getByRole('button', { name: 'Add group' }).click();
  await modal(page).getByLabel('Name').fill('Second group');
  await modal(page).getByRole('button', { name: 'Save' }).click();
  const heads = page.locator('section[aria-labelledby^="group-"] .group-title');
  await expect(heads).toHaveCount(2);
  const second = page.locator('section[aria-labelledby^="group-"]').nth(1);
  await second.locator('.grip').dragTo(page.locator('section[aria-labelledby^="group-"]').first().locator('.group-head'));
  await expect.poll(async () => (await heads.allTextContents()).map((t) => t.replace(/\d+$/, '').trim().toLowerCase())).toEqual(['second group', 'elastic stack']);

  // move a bookmark into the (empty) second group via drag onto its header
  const firstGroup = page.locator('section[aria-labelledby^="group-"]').nth(1); // elastic stack now second
  const card = firstGroup.locator('article.card').first();
  const cardTitle = (await card.locator('.card-title').textContent()) ?? '';
  await card.dragTo(page.locator('section[aria-labelledby^="group-"]').first().locator('.group-head'));
  await expect(page.locator('section[aria-labelledby^="group-"]').first().locator('.card-title')).toHaveText([cardTitle]);

  await page.reload();
  await expect.poll(async () => (await page.locator('section[aria-labelledby^="group-"] .group-title').allTextContents()).map((t) => t.replace(/\d+$/, '').trim().toLowerCase())).toEqual(['second group', 'elastic stack']);
  await expect(page.locator('section[aria-labelledby^="group-"]').first().locator('.card-title')).toHaveText([cardTitle]);
});

test('logo and product name return to workspace selection; browser history stays consistent', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();

  // a second workspace so selection is meaningful
  await page.getByRole('button', { name: /New workspace/ }).first().click();
  await modal(page).getByLabel('Name').fill('Infrastructure');
  await modal(page).getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  const infraUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Infrastructure', level: 2 })).toBeVisible();

  const home = page.getByRole('link', { name: 'Go to workspace selection' });
  await expect(home).toHaveAttribute('href', '/');

  await test.step('click the logo/name from a workspace: client-side navigation, nothing cleared', async () => {
    await page.evaluate(() => { (window as unknown as { __noReload: number }).__noReload = 42; });
    await page.locator('.ws-row.current .ws-item').click(); // ensure the workspace is the remembered one
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(42); // no full page load
    await expect(page.getByRole('link', { name: 'Open workspace Infrastructure' })).toContainText('Last opened');
    await expect(page.getByRole('link', { name: 'Open workspace Observability' })).toBeVisible();
  });

  await test.step('back and forward are consistent', async () => {
    await page.goBack();
    await expect(page).toHaveURL(infraUrl);
    await expect(page.getByRole('heading', { name: 'Infrastructure', level: 2 })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await page.goBack();
  });

  await test.step('choose a workspace from the selection screen; selection only changes when chosen', async () => {
    await home.click();
    await page.getByRole('link', { name: 'Open workspace Observability' }).click();
    await expect(page.getByRole('heading', { name: 'Observability', level: 2 })).toBeVisible();
    await expect(page.locator('.ws-row.current')).toContainText('Observability');
  });

  await test.step('works from nested screens: settings, search results, palette, dialogs closed', async () => {
    await page.getByRole('link', { name: /Settings, data and backups/ }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('link', { name: 'Go to workspace selection' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await page.getByRole('link', { name: 'Open workspace Observability' }).click();
    await page.getByRole('searchbox').fill('kibana');
    await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /result/ })).toBeVisible();
    await home.click();
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    // palette command
    await page.keyboard.press('Control+k');
    await page.keyboard.type('workspace selection');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('keyboard: the link is focusable, has a visible focus ring and activates with Enter', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await home.focus();
    await page.keyboard.press('Shift+Tab'); // keyboard modality: back to the skip link ...
    await page.keyboard.press('Tab'); // ... and forward onto the logo / product name link
    await expect(home).toBeFocused();
    const outline = await home.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
    expect(outline).toMatch(/solid 2px/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  });

  await test.step('deep links and reload work; unknown ids and paths are handled', async () => {
    await page.goto(infraUrl);
    await expect(page.getByRole('heading', { name: 'Infrastructure', level: 2 })).toBeVisible();
    await page.goto('/w/does-not-exist');
    await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Go to workspace selection' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await page.goto('/some/unknown/path');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
  });

  await test.step('workspace management on the selection screen still works', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Actions for workspace Infrastructure' }).last().click();
    await page.getByRole('menuitem', { name: 'Edit name and icon...' }).click();
    await modal(page).getByLabel('Name').fill('Infra');
    await modal(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('link', { name: 'Open workspace Infra' })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for workspace Infra' }).last().click();
    await page.getByRole('menuitem', { name: 'Delete workspace...' }).click();
    await modal(page).getByRole('button', { name: 'Delete workspace' }).click();
    await expect(page.getByRole('link', { name: 'Open workspace Infra' })).toHaveCount(0);
  });

  expect(pageErrors).toEqual([]);
});

test('release version is shown everywhere, matches /api/health, and the Documentation link works', async ({ page, request }) => {
  const pkgVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  const health = (await (await request.get('/api/health')).json()) as { version: string };
  expect(health.version).toBe(pkgVersion);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  const footer = page.locator('.sidebar .app-version');
  await expect(footer).toHaveText(`OpsDesk · v${health.version}`); // workspace selection

  await page.getByRole('link', { name: /^Open workspace / }).first().click();
  await expect(page.locator('.ws-head h2')).toBeVisible();
  await expect(footer).toHaveText(`OpsDesk · v${health.version}`); // workspace screen

  await page.getByRole('link', { name: /Settings, data and backups/ }).click();
  await expect(page.getByTestId('about-version')).toHaveText(`v${health.version}`); // Settings > About
  await expect(page.getByTestId('about-built')).toBeVisible(); // genuine build time exists (production build)
  // no git checkout and no OPSDESK_COMMIT in this environment: nothing is invented
  if (!process.env.OPSDESK_COMMIT) await expect(page.getByTestId('about-commit')).toHaveCount(0);

  await test.step('collapsed sidebar and narrow screens keep a readable version', async () => {
    await page.getByRole('button', { name: /Collapse sidebar/ }).click();
    await expect(footer).toBeVisible();
    await expect(footer).toHaveText(`v${health.version}`, { useInnerText: true }); // visible text only
    const box = await footer.boundingBox();
    const side = await page.locator('.sidebar').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(side!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(side!.x + side!.width + 1);
    await page.getByRole('button', { name: /Expand sidebar/ }).click();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(`v${health.version}`);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step('the Documentation link points at the deployed /docs/ and opens it', async () => {
    const link = page.getByRole('link', { name: 'Documentation' }).first();
    await expect(link).toHaveAttribute('href', '/docs/');
    test.skip(!existsSync('dist/docs/index.html'), 'documentation not built (npm run docs:build)');
    const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await popup.waitForLoadState();
    expect(new URL(popup.url()).pathname).toBe('/docs/');
    await expect(popup.getByRole('heading', { name: 'OpsDesk', level: 1 })).toBeVisible();
    await popup.close();
  });
});

test('documentation site: pages, assets, refresh, search, theme - all served locally', async ({ page }) => {
  test.skip(!existsSync('dist/docs/index.html'), 'documentation not built (npm run docs:build)');
  const external: string[] = [];
  const failed: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:4391') && !r.url().startsWith('data:')) external.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('/docs/');
  await expect(page.getByRole('heading', { name: 'OpsDesk', level: 1 })).toBeVisible();

  // navigation to a nested page, then a direct refresh and a direct load keep working
  await page.getByRole('link', { name: 'Health endpoint' }).first().click();
  await expect(page).toHaveURL(/\/docs\/operations\/health\/$/);
  await expect(page.getByRole('heading', { name: 'Health endpoint', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Health endpoint', level: 1 })).toBeVisible();
  await page.goto('/docs/getting-started/configuration/');
  await expect(page.getByRole('heading', { name: 'Configuration reference', level: 1 })).toBeVisible();
  await page.goto('/docs'); // no trailing slash redirects
  await expect(page).toHaveURL(/\/docs\/$/);

  // copy buttons on code blocks, search, and the colour-mode toggle
  await page.goto('/docs/getting-started/quick-start/');
  await expect(page.locator('button.md-code__button').first()).toBeAttached();
  await page.locator('input.md-search__input').fill('migrations');
  await expect(page.locator('.md-search-result__link').first()).toBeVisible();
  await page.keyboard.press('Escape');
  const scheme = () => page.locator('body').getAttribute('data-md-color-scheme');
  const before = await scheme();
  await page.locator('label.md-header__button[for^="__palette"]:visible').first().click();
  expect(await scheme()).not.toBe(before);

  // the application and the docs share one server; the SPA is not served for docs paths
  expect(await (await page.request.get('/docs/operations/health/')).text()).toContain('Health endpoint');
  expect((await page.request.get('/docs/no/such/page/')).status()).toBe(404);

  expect(failed, 'no failed requests').toEqual([]);
  expect(external, 'documentation makes no external requests').toEqual([]);
  expect(consoleErrors, 'no console errors (CSP violations would show here)').toEqual([]);
});

/* ------------------------------------------------------------------ Swagger UI inside the documentation */
const API_TOKEN = 'e2e-api-token-0123456789abcdefghijklmnop';
const docsBuilt = existsSync('dist/docs/index.html');

test('Swagger UI under /docs/: loads the live contract, Authorize + Try it out work, nothing runs automatically, nothing is persisted', async ({ page, request, context }) => {
  test.skip(!docsBuilt, 'documentation not built (npm run docs:build)');
  const external: string[] = [];
  const apiCalls: string[] = [];
  const consoleErrors: string[] = [];
  let specRequests = 0;
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://127.0.0.1:4391') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
    else if (u.endsWith('/api/v1/openapi.json')) specRequests++;
    else if (u.includes('/api/v1/')) apiCalls.push(`${r.method()} ${new URL(u).pathname}`);
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto('/docs/api/reference/');
  await expect(page.locator('.swagger-ui .info .title')).toContainText('OpsDesk HTTP API');
  expect(specRequests).toBeGreaterThan(0); // the authoritative contract comes from the application endpoint
  await expect(page.locator('.opblock-tag')).toHaveCount(10);
  expect(apiCalls, 'no API request is sent before the user presses Execute').toEqual([]);
  expect(await page.evaluate(() => (window as any).ui.getConfigs().persistAuthorization)).toBe(false);
  expect(await page.evaluate(() => (window as any).ui.getConfigs().validatorUrl)).toBeNull();

  const open = async (tag: string, operationId: string) => {
    const block = page.locator(`[id$="-${operationId}"]`).first();
    if (!(await block.isVisible())) await page.locator(`.opblock-tag[data-tag="${tag}"]`).click(); // expand the collapsed tag
    await expect(block).toBeVisible();
    if (!(await block.evaluate((el) => el.classList.contains('is-open')))) await block.locator('.opblock-summary').click();
    return block;
  };

  await test.step('destructive operations are visibly marked', async () => {
    await open('Workspaces', 'deleteWorkspace');
    await expect(page.locator('.opblock.opsdesk-destructive').first()).toBeVisible();
    await expect(page.locator('[id$="-deleteWorkspace"] .opblock-summary-description')).toContainText('⚠');
    await expect(page.locator('[id$="-deleteWorkspace"]')).toContainText('mode');
  });

  await test.step('Try it out is opt-in: GET /health without credentials', async () => {
    const block = await open('System', 'getHealth');
    await block.getByRole('button', { name: 'Try it out' }).click();
    expect(apiCalls).toEqual([]);
    await block.getByRole('button', { name: 'Execute' }).click();
    await expect(block.locator('.live-responses-table tr.response .response-col_status').first()).toHaveText('200');
    await expect(block.locator('.live-responses-table .microlight').first()).toContainText('"application_name": "opsdesk"');
    expect(apiCalls).toEqual(['GET /api/v1/health']);
  });

  const tryCreate = async (name: string) => {
    const block = await open('Workspaces', 'createWorkspace');
    const toggle = block.getByRole('button', { name: /^(Try it out|Cancel)$/ }).first();
    await expect(toggle).toBeVisible();
    if ((await toggle.innerText()).trim() === 'Try it out') await toggle.click();
    await block.locator('textarea.body-param__text').fill(JSON.stringify({ name }));
    await block.getByRole('button', { name: 'Execute' }).click();
    return block;
  };

  await test.step('a change without credentials is refused (401)', async () => {
    const block = await tryCreate('swagger-e2e-anon');
    await expect(block.locator('.live-responses-table tr.response .response-col_status').first()).toHaveText('401');
    await expect(block.locator('.live-responses-table .microlight').first()).toContainText('authentication_required');
  });

  const name = `swagger-e2e-${Date.now()}`;
  await test.step('Authorize with the bearer token, then the same operation succeeds (201)', async () => {
    await page.locator('.swagger-ui button.authorize').first().click();
    const input = page.locator('.auth-container input[type="text"], .auth-container input[type="password"]').first();
    await expect(input).toBeVisible();
    expect(await input.inputValue()).toBe(''); // never prefilled from server configuration
    await input.fill(API_TOKEN);
    await page.locator('.auth-btn-wrapper button.authorize').click();
    await page.locator('.auth-btn-wrapper button.btn-done, button.btn-done').first().click();
    await page.locator('[id$="-createWorkspace"] button.execute-wrapper, [id$="-createWorkspace"] .btn-clear').first().click().catch(() => undefined);
    const block = await tryCreate(name);
    await expect(block.locator('.live-responses-table tr.response .response-col_status').first()).toHaveText('201');
    const list = (await (await request.get('/api/v1/workspaces', { headers: { Authorization: `Bearer ${API_TOKEN}` } })).json()) as { items: { id: string; name: string }[] };
    const made = list.items.find((w) => w.name === name);
    expect(made, 'workspace created through Swagger exists').toBeTruthy();
    expect((await request.delete(`/api/v1/workspaces/${made!.id}?mode=delete`, { headers: { Authorization: `Bearer ${API_TOKEN}` } })).status()).toBe(200);
  });

  await test.step('the token is not persisted: after a reload the page is unauthorized again', async () => {
    await expect(page.locator('.swagger-ui .scheme-container button.authorize')).toHaveClass(/\blocked\b/); // authorized in memory
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    expect(storage.includes(API_TOKEN)).toBe(false);
    await page.reload();
    await expect(page.locator('.swagger-ui .info .title')).toContainText('OpsDesk HTTP API');
    await expect(page.locator('.swagger-ui .scheme-container button.authorize')).toHaveClass(/\bunlocked\b/);
    const after = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(after.includes(API_TOKEN)).toBe(false);
  });

  await test.step('direct refresh on nested documentation routes works', async () => {
    await page.goto('/docs/api/cookbook/');
    await expect(page.getByRole('heading', { name: 'curl cookbook', level: 1 })).toBeVisible();
    await expect(page.locator('pre code').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'curl cookbook', level: 1 })).toBeVisible();
    expect(await (await request.get('/docs/api/openapi.json')).json()).toHaveProperty('openapi', '3.1.0');
    expect(await (await request.get('/docs/assets/swagger/swagger-ui-bundle.js')).status()).toBe(200);
  });

  expect(external, 'no external requests (no CDN, no validator)').toEqual([]);
  // the only console error allowed is the browser's note about the deliberate unauthenticated request (401) above
  const unexpected = consoleErrors.filter((m) => !/status of 401 \(Unauthorized\)/.test(m));
  expect(unexpected, 'no console errors / CSP violations').toEqual([]);
  expect(consoleErrors.length).toBeLessThanOrEqual(1);
  void context;
});

test('Swagger UI in a standalone docs preview: explicit API server + explicitly allowed origin (no wildcard CORS)', async ({ page, request }) => {
  test.skip(!docsBuilt, 'documentation not built (npm run docs:build)');
  const { createServer } = await import('node:http');
  const { readFile, stat } = await import('node:fs/promises');
  const { extname, join, normalize } = await import('node:path');
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const root = join(process.cwd(), 'dist', 'docs');
  // like `mkdocs serve`: documentation at the origin root, NOT under /docs/ and not served by OpsDesk
  const preview = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
    try {
      if ((await stat(join(root, p))).isDirectory()) p = join(p, 'index.html');
    } catch { /* fall through to 404 */ }
    try {
      const body = await readFile(join(root, p));
      res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((r) => preview.listen(4399, '127.0.0.1', r));
  try {
    await page.goto('http://127.0.0.1:4399/api/reference/');
    await expect(page.locator('.opsdesk-server-form')).toBeVisible();
    await expect(page.locator('.swagger-ui .info .title')).toContainText('OpsDesk HTTP API');
    await page.locator('input[name=api]').fill('http://127.0.0.1:4391');
    await page.getByRole('button', { name: 'Use this server' }).click();
    await expect(page.locator('.swagger-ui .servers label')).toContainText('4391');
    await page.locator('.swagger-ui button.authorize').first().click();
    await page.locator('.auth-container input').first().fill(API_TOKEN);
    await page.locator('.auth-btn-wrapper button.authorize').click();
    await page.locator('button.btn-done').first().click();
    await page.locator('.opblock-tag[data-tag="Workspaces"]').click();
    const block = page.locator('[id$="-listWorkspaces"]').first();
    await block.locator('.opblock-summary').click();
    await block.getByRole('button', { name: 'Try it out' }).click();
    await block.getByRole('button', { name: 'Execute' }).click();
    await expect(block.locator('.live-responses-table tr.response .response-col_status').first()).toHaveText('200');
    await expect(block.locator('.live-responses-table .microlight').first()).toContainText('"items"');
    // the exact origin is allowed, an unlisted one is not (no wildcard)
    const allowed = await request.get('/api/v1/health', { headers: { Origin: 'http://127.0.0.1:4399', Authorization: `Bearer ${API_TOKEN}` } });
    expect(allowed.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:4399');
    const refused = await request.get('/api/v1/workspaces', { headers: { Origin: 'http://127.0.0.1:4398', Authorization: `Bearer ${API_TOKEN}` } });
    expect(refused.status()).toBe(403);
  } finally {
    await new Promise<void>((r) => preview.close(() => r()));
  }
});
