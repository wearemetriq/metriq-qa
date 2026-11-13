// Checks batch mode: every client config, a list file, and that one bad site never stops the run.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { resolveTargets, runBatch } from '../src/batch.js';
import { serveFolder } from '../src/serve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture-site');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metriq-qa-batch-'));
const quickRun = { noA11y: true, noScreens: true, noExternal: true };

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok     ' : 'FAILED '} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};

// A small site with nothing wrong on it, so batch mode has a PASS to report.
const clean = path.join(tmp, 'clean-site');
fs.mkdirSync(path.join(clean, 'img'), { recursive: true });
await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#7a8f6b' } }).jpeg().toFile(path.join(clean, 'img', 'studio.jpg'));
const head = (title, desc) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/img/studio.jpg"><meta property="og:image" content="/img/studio.jpg"><title>${title}</title><meta name="description" content="${desc}"><style>body{font-family:sans-serif;margin:0}main{max-width:900px;margin:0 auto;padding:16px}img{max-width:100%;height:auto}</style></head>`;
const nav = '<header><nav><a href="/">Home</a> <a href="/contact">Contact</a></nav></header>';
fs.writeFileSync(path.join(clean, 'index.html'), `${head('Clean Studio | Home', 'A small pottery studio with weekly classes.')}<body>${nav}<main><h1>Welcome to the studio</h1><p>We teach pottery to kids and adults every week.</p><img src="/img/studio.jpg" alt="Students at the wheel" width="800" height="500"></main></body></html>`);
fs.writeFileSync(path.join(clean, 'contact.html'), `${head('Clean Studio | Contact', 'How to reach the studio.')}<body>${nav}<main><h1>Contact</h1><p>Stop by during open hours or send a note through the front desk.</p></main></body></html>`);
fs.writeFileSync(path.join(clean, '404.html'), `${head('Clean Studio | Not found', 'Page not found.')}<body>${nav}<main><h1>Page not found</h1><p>Try the home page.</p></main></body></html>`);

const cleanServer = await serveFolder(clean);
const fixtureServer = await serveFolder(FIXTURE);
try {
  // 1. Every client config, staging addresses. One has no staging address and is skipped.
  const sitesDir = path.join(tmp, 'sites');
  fs.mkdirSync(sitesDir);
  fs.writeFileSync(path.join(sitesDir, '_template.json'), '{"name":"template"}');
  fs.writeFileSync(path.join(sitesDir, 'cleanstudio.json'), JSON.stringify({ name: 'cleanstudio', environments: { staging: { url: cleanServer.url, type: 'staging' } } }));
  fs.writeFileSync(path.join(sitesDir, 'messystudio.json'), JSON.stringify({ name: 'messystudio', environments: { staging: { url: fixtureServer.url, type: 'staging' } }, exclude: ['^/booking/'] }));
  fs.writeFileSync(path.join(sitesDir, 'liveonly.json'), JSON.stringify({ name: 'liveonly', environments: { live: { url: 'https://example.com', type: 'live' } } }));

  const targets = resolveTargets([], { sitesDir, env: 'staging' });
  check('finds every client file except the template', targets.length === 3, targets.map((t) => t.label).join(', '));
  const all = await runBatch(targets, { out: path.join(tmp, 'reports'), runOptions: quickRun, sitesDir, log: () => {} });
  const by = Object.fromEntries(all.rows.map((r) => [r.label, r]));
  check('clean site passes', by.cleanstudio?.status === 'pass', by.cleanstudio?.status + (by.cleanstudio?.topFixes?.length ? ` ${JSON.stringify(by.cleanstudio.topFixes)}` : ''));
  check('messy site fails', by.messystudio?.status === 'fail', `${by.messystudio?.counts?.fail} to fix`);
  check('client with no staging address is skipped', by.liveonly?.status === 'skipped');
  check('batch result is not all-pass', all.allPass === false);
  check('summary page written', fs.existsSync(all.file) && /cleanstudio/.test(fs.readFileSync(all.file, 'utf8')) && /messystudio/.test(fs.readFileSync(all.file, 'utf8')));
  check('each site report sits inside the batch folder', all.rows.filter((r) => r.report).every((r) => r.report.startsWith(all.batchDir)));
  check('summary lists the main problems', (by.messystudio?.topFixes || []).length > 0, (by.messystudio?.topFixes || []).map((x) => `${x.check} ${x.n}`).join(', '));

  // 2. A list file with a comment, an unreachable site, and a one-page check. The bad site must not stop the rest.
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, [
    '# weekly sweep',
    'http://127.0.0.1:9/',
    cleanServer.url,
    `${new URL('/about', fixtureServer.url)} --only`,
    'not-an-address'
  ].join('\r\n'));
  const listTargets = resolveTargets([list]);
  check('list file read (comments skipped)', listTargets.length === 4, listTargets.map((t) => t.label).join(' | '));
  const fromList = await runBatch(listTargets, { out: path.join(tmp, 'reports'), runOptions: quickRun, log: () => {} });
  const [down, ok, onePage, bad] = fromList.rows;
  check('unreachable site is reported, not fatal', down.status === 'fail' || down.status === 'error', down.status);
  check('run continues after it', ok.status === 'pass', ok.status);
  check('--only in a list checks one page', onePage.pages === 1, `${onePage.pages} page(s)`);
  check('bad line reported as an error', bad.status === 'error');
} finally {
  await cleanServer.close();
  await fixtureServer.close();
}

console.log(failures ? `\n${failures} batch check(s) failed` : '\nBatch mode behaved as expected');
process.exit(failures ? 1 : 0);
