'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const publicRoot = path.resolve(__dirname, '../client/public');
const origin = 'http://inbox-preview.invalid';
const profile = {
  id: 1, uid: 'sidebar-fixture', name: 'Sidebar preview', role: 'user',
  email: 'sidebar@example.invalid', plan: '{}', plan_expire: String(Date.now() + 86400000),
};
const session = {
  role: 'owner', categoryKey: 'training_center', assignedNavigation: null,
  roleNavigation: ['dashboard', 'inbox', 'contacts'], modules: { inbox: true },
};

async function fixture(route) {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/training-sidebar.js' && process.env.SIDEBAR_SOURCE) {
    return route.fulfill({ path: process.env.SIDEBAR_SOURCE, contentType: 'application/javascript' });
  }
  if (url.pathname.startsWith('/api/')) {
    const data = {
      '/api/user/get_me': profile,
      '/api/web/get_web_public': { siteName: '7Network' },
      '/api/web/get-all-translation-name': ['en.json', 'ar.json'],
      '/api/qr/get_all': [],
      '/api/user/get_all_quick_reply': [],
      '/api/workspace/session': session,
    }[url.pathname] || { items: [], total: 0 };
    return route.fulfill({ json: { success: true, data, items: [], addon: [] } });
  }
  const file = path.resolve(publicRoot, '.' + (url.pathname === '/user' ? '/index.html' : url.pathname));
  if (!file.startsWith(publicRoot + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return route.fulfill({ status: 404 });
  }
  return route.fulfill({ path: file });
}

async function dimensions(paper) {
  return paper.evaluate(drawer => {
    const rect = drawer.getBoundingClientRect();
    return {
      paper: Math.round(rect.width),
      root: Math.round(drawer.parentElement.getBoundingClientRect().width),
      list: Math.round(drawer.querySelector('ul').getBoundingClientRect().width),
      left: Math.round(rect.left),
      right: Math.round(innerWidth - rect.right),
      compact: drawer.hasAttribute('data-sx-sidebar-collapsed'),
      offset: parseInt(document.documentElement.style.getPropertyValue('--sx-sidebar-inline-offset'), 10),
      overflow: document.documentElement.scrollWidth > innerWidth + 2,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [320, 390, 600, 768, 899, 900, 1024, 1440, 1685]) for (const rtl of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 }, serviceWorkers: 'block',
        colorScheme: rtl ? 'dark' : 'light',
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let connected = false;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || !url.pathname.startsWith('/socket.io')) return fixture(route);
        let body = '6';
        if (!url.searchParams.has('sid')) {
          body = '0' + JSON.stringify({ sid: 'fixture', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 });
        } else if (route.request().method() === 'POST') {
          body = 'ok';
        } else if (!connected) {
          connected = true;
          body = '40{"sid":"fixture"}\x1e42["connection_ack",{"status":"success"}]\x1e42["chat_list",{"chats":[],"total":0,"offset":0}]';
        } else {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        return route.fulfill({ contentType: 'text/plain', body });
      });
      await page.addInitScript(({ origin, profile, rtl }) => {
        if (location.origin !== origin) return;
        const payload = btoa(JSON.stringify({ uid: profile.uid, role: 'user', exp: 2000000000 }));
        localStorage.setItem('wacrm_user', 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.fixture');
        localStorage.setItem('language', 'en');
        localStorage.setItem('theme_mode', rtl ? 'dark' : 'light');
      }, { origin, profile, rtl });
      await page.goto(origin + '/user?page=inbox');
      try {
        await page.getByRole('heading', { name: 'Inbox', exact: true }).waitFor({ timeout: 5000 });
      } catch (error) {
        console.error(width, errors);
        throw error;
      }
      if (rtl) await page.getByRole('button', { name: 'Switch to RTL' }).click();
      const dock = page.locator('.MuiDrawer-docked > .MuiDrawer-paper:visible');
      const modal = page.locator('.MuiDrawer-modal > .MuiDrawer-paper:visible');
      if (await dock.count()) {
        await dock.locator('[data-sx-desktop-sidebar-toggle]').first().waitFor({ state: 'attached' });
        await page.waitForFunction(() => {
          const drawer = document.querySelector('.MuiDrawer-docked > .MuiDrawer-paper');
          return Math.round(drawer.getBoundingClientRect().width) === 260 && !drawer.hasAttribute('data-sx-sidebar-collapsed');
        }, null, { timeout: 5000 });
        const expanded = await dimensions(dock);
        assert.equal(expanded.paper, expanded.root);
        assert.equal(expanded.paper, expanded.offset);
        assert.equal(rtl ? expanded.right : expanded.left, 0);
        assert.ok(expanded.list > 200, 'The menu must expand along with the drawer');
        assert.equal(expanded.overflow, false);
        assert.equal(await dock.locator('[data-sx-desktop-sidebar-toggle]:visible').count(), 0);
        await dock.getByRole('button', { name: 'Inbox', exact: true }).click();
        await page.waitForFunction(() => {
          const drawer = document.querySelector('.MuiDrawer-docked > .MuiDrawer-paper');
          return Math.round(drawer.getBoundingClientRect().width) === 260 &&
            !drawer.hasAttribute('data-sx-sidebar-collapsed') &&
            drawer.querySelector('input[type="search"]');
        });
      } else {
        const menu = page.locator('header button').first();
        for (let cycle = 0; cycle < 2; cycle++) {
          await menu.click();
          await modal.waitFor();
          const size = await dimensions(modal);
          assert.equal(size.offset, 0);
          assert.equal(size.compact, false);
          assert.ok(size.paper <= width && size.list > 160);
          assert.equal(size.overflow, false);
          await page.keyboard.press('Escape');
          await modal.waitFor({ state: 'hidden' });
        }
      }
      assert.deepEqual(errors, []);
      console.log(width, rtl ? 'RTL' : 'LTR', await dock.count() ? 'desktop' : 'mobile');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
