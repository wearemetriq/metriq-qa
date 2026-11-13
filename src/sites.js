import fs from 'node:fs';
import path from 'node:path';

// Helpers for running the tool from nothing but a URL.

// Accepts "https://site.com/page", "site.com" or "www.site.com" and returns a full URL.
export function normalizeInputUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('No URL given.');
  const local = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/i.test(raw);
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `${local ? 'http' : 'https'}://${raw}`;
  const url = new URL(withScheme);
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') throw new Error(`"${raw}" doesn't look like a web address.`);
  return url.toString();
}

export function looksLikeUrl(arg) {
  if (!arg || arg.startsWith('-')) return false;
  if (/^https?:\/\//i.test(arg)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(arg)) return true;
  // A bare domain like mudhenclayandart.com or www.site.co.uk/page, but not a file path like sites/x.json.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(arg) && !/\.json$/i.test(arg);
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

// A short, file-safe name for a site, used for report and screenshot folders.
export function siteSlug(url) {
  const u = new URL(url);
  const host = bareHost(u.hostname) + (u.port ? `-${u.port}` : '');
  return host.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

// Staging and preview hosts. Anything else is treated as a live, public site.
const STAGING_HOSTS = [
  /\.webflow\.io$/, /\.vercel\.app$/, /\.netlify\.app$/, /\.pages\.dev$/, /\.github\.io$/,
  /\.wpengine\.com$/, /\.wpenginepowered\.com$/, /\.kinsta\.cloud$/, /\.flywheelsites\.com$/,
  /\.instawp\.xyz$/, /\.local$/, /\.test$/,
  /^(staging|stage|dev|preview|test)[.-]/
];
export function guessEnvType(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return 'staging';
  return STAGING_HOSTS.some((r) => r.test(host)) ? 'staging' : 'live';
}

// If the URL belongs to a client that has a sites/<client>.json, use that file so the
// client's own rules (custom words, booking links, never-again rules) apply automatically.
export function findSiteConfig(url, sitesDir) {
  if (!fs.existsSync(sitesDir)) return null;
  const host = bareHost(new URL(url).host);
  for (const file of fs.readdirSync(sitesDir)) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const full = path.join(sitesDir, file);
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    for (const [envName, env] of Object.entries(cfg.environments || {})) {
      if (!env?.url) continue;
      try {
        if (bareHost(new URL(env.url).host) === host) return { configPath: full, envName };
      } catch { /* skip a bad URL in a config */ }
    }
  }
  return null;
}

// Links the crawler and link checker must never open. On a signed-in session these can log
// you out or change content (WordPress "Trash" links are plain GET links with a nonce).
export const UNSAFE_LINK = /\/wp-admin\b|\/wp-login\.php|[?&](action|_wpnonce|add-to-cart|remove_item|delete|logout)=|\/(log-?out|sign-?out)(\/|$|\?)|\/admin(\/|$)|\/account\/logout/i;
