import fs from 'node:fs';
import path from 'node:path';

export const SEVERITIES = ['fail', 'warn', 'info'];

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function slugForUrl(u) {
  try {
    const url = new URL(u);
    let p = url.pathname.replace(/\/+$/, '');
    if (!p) p = 'home';
    let s = p.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    if (url.search) s += '-q-' + url.search.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return (s || 'home').slice(0, 90);
  } catch {
    return String(u).replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 90);
  }
}

export function pathOf(u) {
  try {
    const url = new URL(u);
    return url.pathname + url.search;
  } catch {
    return u;
  }
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function snippetAround(text, needle, radius = 60) {
  const i = text.indexOf(needle);
  if (i < 0) return '';
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return (start > 0 ? '...' : '') + normalizeSpace(text.slice(start, end)) + (end < text.length ? '...' : '');
}

export function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function toRegex(pattern, flags = 'i') {
  if (pattern instanceof RegExp) return pattern;
  return new RegExp(pattern, flags);
}

export function relPath(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
