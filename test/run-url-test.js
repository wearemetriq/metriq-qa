// Checks the URL-first workflow: a bare URL with no config, --only for one page,
// automatic pickup of a client's sites/<client>.json, and reuse of a saved sign-in.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runQa, authFileFor } from '../src/run.js';
import { serveFolder } from '../src/serve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, 'fixture-site');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metriq-qa-url-'));
const emptySites = path.join(tmp, 'no-sites');
fs.mkdirSync(emptySites, { recursive: true });
const quick = { quiet: true, noA11y: true, noScreens: true, noExternal: true, out: path.join(tmp, 'reports'), now: '2026-11-13T12:00:00' };

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok     ' : 'FAILED '} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};

const server = await serveFolder(SITE);
try {
  // 1. Just a URL: whole site, standard checks, report named after the site.
  const whole = await runQa({ ...quick, url: server.url, sitesDir: emptySites });
  check('URL only crawls the whole site', whole.pages.length >= 4, `${whole.pages.length} pages`);
  check('report folder is named after the site', /^127-0-0-1-\d+-staging-/.test(path.basename(whole.outDir)), path.basename(whole.outDir));
  check('local address is treated as staging', path.basename(whole.outDir).includes('-staging-'));

  // 2. --only: just the page in the URL.
  const one = await runQa({ ...quick, url: new URL('/about', server.url).toString(), only: true, sitesDir: emptySites });
  check('--only checks one page', one.pages.length === 1 && /\/about$/.test(one.pages[0].url), one.pages.map((p) => new URL(p.url).pathname).join(', '));

  // 3. A URL that belongs to a client config picks up that client's rules.
  const sitesDir = path.join(tmp, 'sites');
  fs.mkdirSync(sitesDir, { recursive: true });
  fs.writeFileSync(path.join(sitesDir, 'teststudio.json'), JSON.stringify({
    name: 'teststudio',
    environments: { staging: { url: server.url, type: 'staging' } },
    rules: [{ id: 'waiver-state', type: 'forbidText', pattern: '\\bArizona\\b', severity: 'fail', message: 'Mentions Arizona' }]
  }));
  const matched = await runQa({ ...quick, url: server.url, sitesDir });
  check('client config is found from the URL', path.basename(matched.outDir).startsWith('teststudio-staging-'), path.basename(matched.outDir));
  check('client rules apply', matched.findings.some((f) => f.check === 'never-again: waiver-state'));
} finally {
  await server.close();
}

// 4. A saved sign-in is reused: the gated page shows its real content only with the cookie.
const gated = http.createServer((req, res) => {
  const ok = /(^|;\s*)pw=ok/.test(req.headers.cookie || '');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(ok
    ? '<!doctype html><html lang="en"><head><title>Members</title></head><body><h1>Members</h1><p>Secret studio schedule for members.</p></body></html>'
    : '<!doctype html><html lang="en"><head><title>Protected page</title></head><body><h1>Protected</h1><form><label>Password <input type="password" name="pass"></label></form></body></html>');
});
await new Promise((r) => gated.listen(0, '127.0.0.1', r));
const gatedUrl = `http://127.0.0.1:${gated.address().port}/`;
const authFile = authFileFor(gatedUrl);
try {
  const before = await runQa({ ...quick, url: gatedUrl, only: true, sitesDir: emptySites });
  check('without a sign-in the gate page is seen', /Protected/.test(before.pages[0].data?.text || ''));
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, JSON.stringify({
    cookies: [{ name: 'pw', value: 'ok', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }],
    origins: []
  }));
  const after = await runQa({ ...quick, url: gatedUrl, only: true, sitesDir: emptySites });
  check('with a saved sign-in the real page is seen', /Secret studio schedule/.test(after.pages[0].data?.text || ''));
} finally {
  fs.rmSync(authFile, { force: true });
  gated.close();
}

console.log(failures ? `\n${failures} URL check(s) failed` : '\nURL workflow behaved as expected');
process.exit(failures ? 1 : 0);
