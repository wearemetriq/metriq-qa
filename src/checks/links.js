import path from 'node:path';
import { normalizeUrl } from '../crawl.js';
import { toRegex, ensureDir, slugForUrl, normalizeSpace } from '../util.js';
import { UNSAFE_LINK } from '../sites.js';

async function statusOf(request, url) {
  try {
    const res = await request.get(url, { timeout: 20000, maxRedirects: 10, failOnStatusCode: false });
    return res.status();
  } catch (err) {
    return String(err.message || err).includes('Timeout') ? 'timeout' : 'error';
  }
}

export async function checkLinks(pages, cfg, { context, baseUrl, outDir, log }) {
  const findings = [];
  const request = context.request;
  const origin = new URL(baseUrl).origin;
  const crawled = new Map(pages.map((p) => [p.url, p.status]));
  const skip = cfg.skipLinkCheck.map((p) => toRegex(p, 'i'));
  const linkMap = new Map(); // url -> [{page, text}]
  for (const p of pages) {
    if (!p.data) continue;
    for (const l of p.data.links) {
      if (!/^https?:/i.test(l.abs || '')) continue;
      const n = normalizeUrl(l.abs, p.url);
      if (!n) continue;
      if (!linkMap.has(n)) linkMap.set(n, []);
      linkMap.get(n).push({ page: p.url, text: l.text });
    }
  }

  let checked = 0;
  for (const [url, refs] of linkMap) {
    const internal = new URL(url).origin === origin;
    if (!internal && !cfg.checks.externalLinks) continue;
    if (!internal && skip.some((r) => r.test(url))) continue;
    if (UNSAFE_LINK.test(url)) continue; // admin, logout and action links are never opened
    const status = crawled.has(url) ? crawled.get(url) : await statusOf(request, url);
    checked++;
    if (status === 'error' || status === 'timeout' || status >= 400) {
      const blockedLikely = !internal && (status === 403 || status === 429 || status === 999);
      for (const ref of dedupe(refs)) {
        findings.push({
          check: 'broken links',
          severity: blockedLikely ? 'warn' : 'fail',
          page: ref.page,
          message: `"${ref.text || url}" -> ${status === 'error' || status === 'timeout' ? status : 'HTTP ' + status}${blockedLikely ? ' (the site may just block automated checks; open it by hand)' : ''}`,
          detail: url
        });
      }
    }
  }
  log(`  checked ${checked} unique links`);

  // Booking and scheduling links: warn on fragile link styles, then render each one and keep a screenshot.
  const bookingDir = ensureDir(path.join(outDir, 'booking'));
  for (const b of cfg.bookingLinks || []) {
    const re = toRegex(b.match, 'i');
    const broken = (b.brokenTextPatterns || []).map((x) => toRegex(x, 'i'));
    const targets = [...linkMap.entries()].filter(([u]) => re.test(u));
    for (const [url, refs] of targets) {
      for (const w of b.warnPatterns || []) {
        if (toRegex(w.pattern, 'i').test(url)) {
          for (const ref of dedupe(refs)) findings.push({ check: 'booking links', severity: w.severity || 'warn', page: ref.page, message: w.message, detail: `"${ref.text}" -> ${url}` });
        }
      }
      if (b.render === false) continue;
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 45000 }));
        await page.waitForTimeout(1500);
        const text = normalizeSpace(await page.evaluate(() => document.body?.innerText || ''));
        const file = path.join(bookingDir, `${slugForUrl(url)}-${Math.abs(hash(url))}.png`);
        await page.screenshot({ path: file, fullPage: false });
        const hit = broken.find((r) => r.test(text));
        for (const ref of dedupe(refs)) {
          findings.push({
            check: 'booking links',
            severity: hit ? 'fail' : 'info',
            page: ref.page,
            message: hit ? `"${ref.text}" opens a booking page that looks broken ("${text.match(hit)[0]}")` : `"${ref.text}" booking page loaded; screenshot saved for a quick look`,
            detail: url,
            screenshot: file
          });
        }
      } catch (err) {
        for (const ref of dedupe(refs)) findings.push({ check: 'booking links', severity: 'fail', page: ref.page, message: `"${ref.text}" booking page failed to load`, detail: `${url} ${String(err.message || err).slice(0, 120)}` });
      } finally {
        await page.close();
      }
    }
  }
  return findings;
}

export async function checkNotFound(cfg, { context, baseUrl, outDir }) {
  const findings = [];
  const url = new URL(`/qa-missing-page-${Date.now()}`, baseUrl).toString();
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const status = res ? res.status() : 0;
    const file = path.join(ensureDir(path.join(outDir, 'screens')), '404-page.png');
    await page.screenshot({ path: file, fullPage: false });
    const navLinks = await page.evaluate(() => document.querySelectorAll('nav a, header a, [role="navigation"] a').length);
    if (status !== 404) {
      findings.push({ check: '404 page', severity: 'fail', page: url, message: `A missing page returns HTTP ${status} instead of 404`, detail: 'Search engines will index error pages as real pages.', screenshot: file });
    }
    if (navLinks === 0) {
      findings.push({ check: '404 page', severity: 'warn', page: url, message: 'The 404 page has no site navigation (it is probably unstyled)', screenshot: file });
    } else {
      findings.push({ check: '404 page', severity: 'info', page: url, message: '404 page screenshot saved for a look', screenshot: file });
    }
  } catch (err) {
    findings.push({ check: '404 page', severity: 'warn', page: url, message: 'Could not load a missing-page URL to check the 404 page', detail: String(err.message || err).slice(0, 150) });
  } finally {
    await page.close();
  }
  return findings;
}

function dedupe(refs) {
  const seen = new Set();
  return refs.filter((r) => {
    const k = r.page + '|' + r.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
