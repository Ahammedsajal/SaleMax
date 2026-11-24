'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.SALEMAX_PLAYWRIGHT_PATH || 'playwright');

const inventory = fs.readFileSync(path.join(__dirname, '../client/public/business-inventory.js'));
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<script defer src="/business-inventory.js"></script></head><body></body></html>';
const server = http.createServer((request, response) => {
  if (request.url === '/business-inventory.js') {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    return response.end(inventory);
  }
  if (request.url.startsWith('/user?')) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.end(html);
  }
  response.writeHead(404).end();
});

async function checkEmptyInventory(browser, origin, { language, colorScheme, width, canManage }) {
  const page = await browser.newPage({ viewport: { width, height: 850 }, colorScheme });
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ language, canManage, colorScheme }) => {
      localStorage.setItem('language', language);
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.lang = language;
        document.documentElement.dataset.sxTheme = colorScheme;
      }, { once: true });
      window.SaleMaxWorkspace = {
        session: async () => ({
          modules: { inventory: true },
          roleNavigation: ['business-inventory'],
          permissions: { 'inventory.manage': canManage, 'retail.configure': canManage },
        }),
        request: async (module, route) => {
          if (module === 'inventory' && route === '/locations') return { data: [] };
          throw new Error('Unexpected empty-inventory API request');
        },
      };
    }, { language, canManage, colorScheme });
    await page.goto(origin + '/user?page=business-inventory');
    const root = page.locator('#sx-business-inventory');
    await root.getByRole('status').waitFor({ timeout: 5000 });
    const arabic = language === 'ar';
    assert.equal(await root.getAttribute('dir'), arabic ? 'rtl' : 'ltr');
    const addLocation = root.getByRole('button', { name: arabic ? 'إضافة موقع' : 'Add location' });
    if (canManage) await addLocation.waitFor({ timeout: 2000 });
    assert.equal(await addLocation.isVisible(), canManage);
    assert.equal(await root.getByRole('searchbox').isVisible(), false);
    assert.match(await root.getByRole('status').innerText(),
      canManage ? (arabic ? /أضف موقع/ : /Add a stock location/) : (arabic ? /سيظهر المخزون/ : /Inventory will appear/));
    assert.equal(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error({ language, colorScheme, width, canManage, status: await page.locator('body').innerText() });
    throw error;
  } finally {
    await page.close();
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const screens = [
      { language: 'en', colorScheme: 'light', width: 1440, canManage: true },
      { language: 'ar', colorScheme: 'dark', width: 390, canManage: true },
      { language: 'en', colorScheme: 'dark', width: 390, canManage: false },
      { language: 'ar', colorScheme: 'light', width: 768, canManage: false },
    ];
    for (const screen of screens) await checkEmptyInventory(browser, origin, screen);
    console.log('PASS: first-location setup and read-only empty states across English, Arabic RTL, themes, and viewports');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
