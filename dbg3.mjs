import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbg3-auth-'));
const port = 19779;
const server = spawn(process.execPath, ['-r', './test/mock-upstream.cjs', 'server.cjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TMDB_API_KEY: 'integration-test-key', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => server.stdout.on('data', (c) => String(c).includes('Catalog server listening') && r()));
const dbgPort = 9779;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${process.cwd()}/.cache/chrome-dbg-${dbgPort}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
const { CDP } = await import('./test/cdp-client.js');
const cdp = await new CDP(`http://127.0.0.1:${dbgPort}`).connect();
const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
const page = await cdp.attach((await cdp.waitForTarget((t) => t.targetId === targetId)).targetId);
await page.call('Page.enable');
await page.call('Runtime.enable');
await page.call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await page.evaluate(`new Promise((r) => { const p = () => document.querySelector('.login-button') ? r(1) : setTimeout(p, 30); p(); })`);
await page.evaluate(`(async () => { await fetch('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Flow Tester', email: 'dbg3-${Date.now()}@example.com', password: 'stillframe-test-1' }) }); })()`);
await page.call('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await page.evaluate(`new Promise((r) => { const p = () => document.querySelector('.user-menu-button') ? r(1) : setTimeout(p, 30); p(); })`);
const remote = await page.call('Runtime.evaluate', { expression: `document.getElementById('userMenuButton')` });
const listeners = await page.call('DOMDebugger.getEventListeners', { objectId: remote.result.objectId });
console.log('probe:', await page.evaluate(`(() => {
  const before = document.getElementById('userMenuButton');
  before.dataset.probe = 'A';
  before.click();
  const after = document.getElementById('userMenuButton');
  return JSON.stringify({
    same: before === after,
    probeKept: after.dataset.probe === 'A',
    siblingMenuHidden: before.parentElement.querySelector('#userMenu')?.hidden,
    byIdHidden: document.getElementById('userMenu').hidden,
    menus: document.querySelectorAll('.user-menu').length,
    buttons: document.querySelectorAll('#userMenuButton').length,
    expandedBefore: before.getAttribute('aria-expanded'),
    expandedAfter: after.getAttribute('aria-expanded'),
    active: before.classList.contains('active'),
    clicks: document.documentElement.dataset.menuClicks || 'none'
  });
})()`));
await cdp.close();
browser.kill();
server.kill();
fs.rmSync(dir, { recursive: true, force: true });
