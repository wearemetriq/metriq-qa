import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadWordList } from './config.js';
import { launchBrowser } from './browser.js';
import { serveFolder } from './serve.js';
import { crawlSite } from './crawl.js';
import { buildSpeller, checkSpelling, checkRepeats, checkPlaceholders, checkStale, checkContactDetails, checkRules } from './checks/text.js';
import { checkPageHealth, checkMeta, checkNavigation, checkCtas, checkLayout, checkForms, checkA11y } from './checks/structure.js';
import { checkImages } from './checks/images.js';
import { checkLinks, checkNotFound } from './checks/links.js';
import { compareBaselines } from './visual.js';
import { writeReport, writeTextBundles, writeAiReviewBrief } from './report.js';
import { ensureDir, timestamp } from './util.js';
import { normalizeInputUrl, findSiteConfig, siteSlug, guessEnvType } from './sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runQa(opts) {
  const log = opts.quiet ? () => {} : (m) => console.log(m);

  // URL-only runs: use the client's sites/<client>.json if the URL belongs to one,
  // otherwise run the standard checks and name the report after the site.
  let inputUrl = opts.url ? normalizeInputUrl(opts.url) : null;
  let configPath = opts.config;
  let matchedEnv = null;
  if (inputUrl && !configPath && !opts.serve) {
    const match = findSiteConfig(inputUrl, opts.sitesDir || path.join(ROOT, 'sites'));
    if (match) {
      configPath = match.configPath;
      matchedEnv = match.envName;
      log(`Using ${path.relative(process.cwd(), match.configPath) || match.configPath} rules (${match.envName})`);
    }
  }
  const cfg = loadConfig(configPath);
  if (opts.noA11y) cfg.checks.a11y = false;
  if (opts.noExternal) cfg.checks.externalLinks = false;
  if (opts.noScreens) cfg.checks.screenshots = false;
  if (inputUrl && !configPath) cfg.name = siteSlug(inputUrl);

  const envName = opts.env || matchedEnv || Object.keys(cfg.environments)[0] || (inputUrl ? guessEnvType(inputUrl) : 'local');
  const env = cfg.environments[envName] || {};
  let server = null;
  let pagesOnly = opts.pages;
  if (inputUrl && opts.only) {
    const u = new URL(inputUrl);
    pagesOnly = [u.pathname + u.search];
  }
  let baseUrl = inputUrl ? new URL(inputUrl).origin + '/' : env.url;
  const serveDir = opts.serve || (env.serve ? path.resolve(cfg._configDir, env.serve) : null);
  if (serveDir) {
    server = await serveFolder(serveDir);
    baseUrl = server.url;
    log(`Serving ${serveDir} at ${baseUrl}`);
  }
  if (!baseUrl) throw new Error(`No URL. Pass --url, --serve <folder>, or set environments.${envName}.url in the config.`);
  const envType = opts.envType || env.type || (inputUrl && !configPath ? guessEnvType(inputUrl) : (envName === 'live' ? 'live' : 'staging'));
  const authFile = authFileFor(baseUrl);
  const storageState = fs.existsSync(authFile) ? authFile : undefined;
  if (storageState) log(`Using saved sign-in for ${new URL(baseUrl).host}`);

  const outDir = ensureDir(path.resolve(opts.out || path.join(ROOT, 'reports'), `${cfg.name}-${envName}-${timestamp()}`));
  log(`QA: ${cfg.name} (${envName}) ${baseUrl}`);

  const words = [...loadWordList(path.join(ROOT, 'dictionaries', 'metriq-words.txt')), ...cfg.customWords];
  const speller = buildSpeller(words);
  const browser = await launchBrowser();
  const findings = [];
  let crawl;
  try {
    crawl = await crawlSite({
      browser,
      cfg,
      baseUrl,
      outDir,
      pagesOnly,
      maxPages: opts.maxPages || cfg.maxPages,
      httpCredentials: env.httpCredentials,
      storageState,
      log
    });
    const { pages, imageBytes, context } = crawl;
    log(`Crawled ${pages.length} page(s). Running checks...`);

    findings.push(...checkPageHealth(pages));
    const spelling = checkSpelling(pages, speller, cfg);
    findings.push(...spelling.findings);
    findings.push(...checkRepeats(pages));
    findings.push(...checkPlaceholders(pages, cfg));
    findings.push(...checkStale(pages, cfg, opts.now ? new Date(opts.now) : new Date()));
    findings.push(...checkContactDetails(pages, cfg));
    findings.push(...checkRules(pages, cfg));
    findings.push(...checkMeta(pages, cfg, envType));
    findings.push(...checkNavigation(pages));
    findings.push(...checkCtas(pages));
    findings.push(...checkLayout(pages));
    findings.push(...checkForms(pages, cfg, speller));
    findings.push(...checkA11y(pages, cfg));
    findings.push(...(await checkImages(pages, cfg, { request: context.request, imageBytes })));
    findings.push(...(await checkLinks(pages, cfg, { context, baseUrl, outDir, log })));
    if (cfg.checks.notFoundPage && !pagesOnly?.length) findings.push(...(await checkNotFound(cfg, { context, baseUrl, outDir })));

    if (cfg.checks.screenshots && cfg.checks.visualDiff) {
      const baselineRoot = opts.config ? path.resolve(cfg._configDir, cfg.baselineDir || path.join('..', 'baselines')) : path.join(ROOT, 'baselines');
      const baselineDir = path.join(baselineRoot, `${cfg.name}-${envName}`);
      const vis = compareBaselines(pages, cfg, { baselineDir, outDir, update: opts.updateBaseline });
      findings.push(...vis.findings);
      if (opts.updateBaseline) log(`Saved approved screenshots to ${baselineDir}`);
      else if (!vis.compared) log('No approved screenshots yet. After reviewing this run, approve it with --update-baseline.');
    }

    writeTextBundles(pages, outDir);
    const meta = { site: cfg.name, env: envName, url: baseUrl, when: new Date().toLocaleString(), notCrawled: crawl.notCrawled };
    writeAiReviewBrief(pages, outDir, meta);
    const result = writeReport({ findings, pages, outDir, meta, misspelled: spelling.misspelled });
    await context.close();
    log('');
    log(`${result.pass ? 'PASS' : 'FAIL'}: ${result.counts.fail} to fix, ${result.counts.warn} to review, ${result.counts.info} notes`);
    log(`Report: ${result.file}`);
    return { ...result, outDir, findings, pages };
  } finally {
    await browser.close();
    if (server) await server.close();
  }
}

export function initSite(name, url, sitesDir) {
  const file = path.join(sitesDir, `${name}.json`);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  const tpl = JSON.parse(fs.readFileSync(path.join(sitesDir, '_template.json'), 'utf8'));
  tpl.name = name;
  tpl.environments.staging.url = url;
  fs.writeFileSync(file, JSON.stringify(tpl, null, 2));
  return file;
}

// Saved sign-ins live in auth/<site>.json (git-ignored). Any run against that site reuses it.
export function authFileFor(url) {
  return path.join(ROOT, 'auth', `${siteSlug(url)}.json`);
}

// Opens a visible browser so you can sign in (a Webflow site password, a WordPress login),
// then saves that session so QA runs can see the same pages you can.
export async function saveLogin(rawUrl, { waitForEnter } = {}) {
  const url = normalizeInputUrl(rawUrl);
  const browser = await launchBrowser({ headless: false });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await waitForEnter();
    const file = authFileFor(url);
    ensureDir(path.dirname(file));
    await context.storageState({ path: file });
    return file;
  } finally {
    await browser.close();
  }
}
