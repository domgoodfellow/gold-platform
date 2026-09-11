import { mkdir, writeFile } from 'node:fs/promises';

const [email, password] = process.argv.slice(2);
if (!email || !password) throw new Error('Usage: node platform-visual.mjs <email> <password>');

const tabs = await fetch('http://127.0.0.1:9224/json').then((response) => response.json());
const tab = tabs.find((entry) => entry.type === 'page');
if (!tab) throw new Error('No Chrome page target found.');

const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
async function navigate(path) {
  await command('Page.navigate', { url: `http://localhost:3000${path}` });
  await pause(900);
}
async function viewport(width, height = 900) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
}
async function screenshot(name) {
  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../../../../.artifacts/platform/${name}.png`, import.meta.url), Buffer.from(capture.data, 'base64'));
}

await mkdir(new URL('../../../../.artifacts/platform/', import.meta.url), { recursive: true });
await command('Page.enable');
await command('Runtime.enable');
await viewport(1440, 1000);
await navigate('/login');
await evaluate(`(() => {
  const set = (selector, value) => {
    const input = document.querySelector(selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('input[name="email"]', ${JSON.stringify(email)});
  set('input[name="password"]', ${JSON.stringify(password)});
  document.querySelector('input[name="password"]').form.requestSubmit();
})()`);
await pause(1400);
await navigate('/platform/organizations');
await evaluate(`document.querySelector('aside button[aria-label="Expand sidebar"]')?.click()`);
await pause(200);

const reports = [];
for (const width of [390, 768, 1024, 1440, 1920]) {
  await viewport(width, width === 390 ? 844 : 900);
  await pause(200);
  reports.push(await evaluate(`(() => {
    const header = document.querySelector('header');
    const aside = document.querySelector('aside');
    const sidebarHeader = aside?.querySelector(':scope > div');
    return { width: innerWidth, path: location.pathname, bodyWidth: document.body.scrollWidth,
      headerBottom: header?.getBoundingClientRect().bottom ?? null,
      sidebarHeaderBottom: sidebarHeader?.getBoundingClientRect().bottom ?? null,
      sidebarVisible: !!aside && getComputedStyle(aside).display !== 'none' };
  })()`));
  await screenshot(`organizations-${width}`);
}

await viewport(1440, 1000);
for (const [name, path] of [
  ['products', '/platform/catalog/products'],
  ['modules', '/platform/catalog/modules'],
  ['meters', '/platform/catalog/meters'],
  ['pricing', '/platform/pricing'],
  ['providers', '/platform/providers'],
  ['failures', '/platform/failures'],
]) {
  await navigate(path);
  await screenshot(name);
}

await navigate('/platform/organizations');
const tenantHref = await evaluate(`document.querySelector('a[href^="/platform/organizations/"]')?.getAttribute('href') ?? null`);
if (tenantHref) {
  for (const suffix of ['', '/commercial', '/providers', '/usage', '/failures']) {
    await navigate(`${tenantHref}${suffix}`);
    await screenshot(`tenant-${suffix.slice(1) || 'overview'}`);
  }
}

await navigate('/platform/pricing');
await evaluate(`document.querySelector('aside button[aria-label="Collapse sidebar"]')?.click()`);
await pause(250);
const collapsed = await evaluate(`(() => ({
  sidebarWidth: document.querySelector('aside')?.getBoundingClientRect().width,
  collapseLabel: document.querySelector('button[aria-label="Expand sidebar"]')?.getAttribute('aria-label'),
  accountAtBottom: Math.abs(document.querySelector('aside footer')?.getBoundingClientRect().bottom - innerHeight) < 2,
  hasBottomCollapse: !!document.querySelector('aside footer button[aria-label*="sidebar"]')
}))()`);
await screenshot('pricing-collapsed');

console.log(JSON.stringify({ reports, collapsed, tenantInspected: Boolean(tenantHref) }, null, 2));
socket.close();
