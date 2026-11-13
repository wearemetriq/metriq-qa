import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { extractPage, autoScroll } from './extract.js';
import { ensureDir, slugForUrl, toRegex, sleep } from './util.js';

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|zip|docx?|xlsx?|pptx?|mp4|mov|mp3|ics|csv)$/i;
const FREEZE_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}`;

export function normalizeUrl(u, base) {
  try {
    const url = new URL(u, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) url.searchParams.delete(k);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export async function crawlSite({ browser, cfg, baseUrl, outDir, pagesOnly, maxPages, httpCredentials, log }) {
  const origin = new URL(baseUrl).origin;
  const exclude = (cfg.exclude || []).map((p) => toRegex(p));
  const isExcluded = (u) => exclude.some((r) => r.test(new URL(u).pathname + new URL(u).search));
  const ruleSelectors = (cfg.rules || []).filter((r) => r.selector).map((r) => r.selector);
  const viewports = [...cfg.viewports].sort((a, b) => b - a);
  const desktop = viewports[0];
  const shotsDir = ensureDir(path.join(outDir, 'screens'));

  const context = await browser.newContext({
    viewport: { width: desktop, height: 900 },
    httpCredentials: httpCredentials || undefined,
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    userAgent: undefined
  });
  const imageBytes = new Map();
  context.on('response', async (res) => {
    try {
      if (res.request().resourceType() !== 'image') return;
      const len = Number(res.headers()['content-length'] || 0);
      if (len) imageBytes.set(res.url(), len);
      else {
        const body = await res.body().catch(() => null);
        if (body) imageBytes.set(res.url(), body.length);
      }
    } catch { /* ignore */ }
  });

  const queue = [];
  const seen = new Set();
  const enqueue = (u) => {
    const n = normalizeUrl(u, baseUrl);
    if (!n || seen.has(n)) return;
    if (new URL(n).origin !== origin || SKIP_EXT.test(new URL(n).pathname) || isExcluded(n)) return;
    seen.add(n);
    queue.push(n);
  };
  if (pagesOnly?.length) pagesOnly.forEach((p) => enqueue(new URL(p, baseUrl).toString()));
  else (cfg.startPaths || ['/']).forEach((p) => enqueue(new URL(p, baseUrl).toString()));

  // Pick up sitemap pages too, so pages not linked from the nav still get checked.
  if (!pagesOnly?.length) {
    try {
      const res = await context.request.get(new URL('/sitemap.xml', baseUrl).toString(), { timeout: 15000 });
      if (res.ok()) {
        const xml = await res.text();
        for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
          const loc = new URL(m[1]);
          enqueue(new URL(loc.pathname + loc.search, baseUrl).toString());
        }
      }
    } catch { /* no sitemap */ }
  }

  const pages = [];
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); });
  page.on('pageerror', (err) => consoleErrors.push(String(err.message || err).slice(0, 300)));

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    consoleErrors.length = 0;
    const rec = { url, slug: slugForUrl(url), status: 0, screenshots: {}, overflow: {}, axe: [], consoleErrors: [] };
    log(`  checking ${new URL(url).pathname}`);
    try {
      await page.setViewportSize({ width: desktop, height: 900 });
      let res;
      try {
        res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      } catch {
        res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      }
      rec.status = res ? res.status() : 0;
      rec.finalUrl = page.url();
      if (rec.status >= 400) {
        // A missing page is reported once, as a broken link and a page-load failure, not checked for content.
        pages.push(rec);
        continue;
      }
      await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
      await autoScroll(page);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      rec.data = await page.evaluate(extractPage, { ignoreSelectors: cfg.ignoreSelectors || [], ruleSelectors });
      for (const l of rec.data.links) if (l.abs) enqueue(l.abs);

      if (cfg.checks.a11y) {
        try {
          const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
          rec.axe = axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes: v.nodes.length,
            targets: v.nodes.slice(0, 3).map((n) => n.target.join(' '))
          }));
        } catch (err) {
          rec.axeError = String(err.message || err).slice(0, 200);
        }
      }

      for (const w of viewports) {
        if (w !== desktop) {
          await page.setViewportSize({ width: w, height: 900 });
          await sleep(350);
          await autoScroll(page);
        }
        rec.overflow[w] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (cfg.checks.screenshots) {
          const file = path.join(shotsDir, `${rec.slug}-${w}.png`);
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          if (height > 16000) await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: 16000 }, fullPage: true });
          else await page.screenshot({ path: file, fullPage: true });
          rec.screenshots[w] = file;
        }
      }
    } catch (err) {
      rec.loadError = String(err.message || err).slice(0, 300);
    }
    rec.consoleErrors = [...new Set(consoleErrors)];
    pages.push(rec);
  }

  const notCrawled = queue.length;
  return { pages, imageBytes, context, notCrawled };
}
