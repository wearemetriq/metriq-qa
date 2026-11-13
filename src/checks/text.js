import dictionary from 'dictionary-en';
import nspell from 'nspell';
import { levenshtein, snippetAround, toRegex, normalizeSpace } from '../util.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SKIP_REPEATS = new Set(['that', 'had', 'is', 'very', 'bye', 'no', 'so', 'ha', 'la', 'dum', 'knock', 'go', 'tsk', 'chop', 'boo', 'clap']);

export function buildSpeller(words) {
  const spell = nspell(dictionary);
  const parts = words.flatMap((w) => String(w).split(/\s+/)).filter(Boolean);
  for (const w of parts) {
    spell.add(w);
    spell.add(w.toLowerCase());
  }
  return { spell, custom: new Set(parts.map((w) => w.toLowerCase())) };
}

function stripNonWords(text) {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, ' ')
    .replace(/\b[\w-]+\.(com|org|net|io|co|us|edu|gov|me|app|dev)\b\S*/gi, ' ')
    .replace(/[@#][\w]+/g, ' ')
    .replace(/(\p{L})\((s|es|ies|ren)\)/giu, '$1')   // child(ren), class(es)
    .replace(/\S+(\.\.\.|…)\s*$/u, ' ');            // the last word of cut-off text ("and we are joi...")
}

// Prefixes that are fine on their own before a hyphen ("Pre-Order", "co-op", "non-toxic").
const PREFIXES = new Set(['pre', 'post', 'non', 'multi', 'semi', 'anti', 'mid', 'sub', 'self', 'inter', 'over', 'under', 'mini', 'micro', 'mega', 'ultra', 'extra', 'co', 're', 'un', 'bi', 'tri', 'ex', 'e']);

function wordsOf(text) {
  const out = [];
  for (const compound of stripNonWords(text).match(/\p{L}[\p{L}'’-]*\p{L}/gu) || []) {
    const parts = compound.split('-').filter(Boolean);
    parts.forEach((part, i) => {
      if (i < parts.length - 1 && PREFIXES.has(part.toLowerCase())) return;
      out.push(part);
    });
  }
  return out;
}

const plain = (w) => w.normalize('NFD').replace(/\p{M}/gu, ''); // fiancé -> fiance

export function checkSpelling(pages, speller, cfg) {
  const { spell, custom } = speller;
  const bad = new Map();
  const caps = new Map();
  const add = (map, word, page, source, context) => {
    const k = word;
    if (!map.has(k)) map.set(k, { word, count: 0, pages: new Set(), sources: new Set(), context });
    const e = map.get(k);
    e.count++;
    e.pages.add(page);
    e.sources.add(source);
  };
  for (const p of pages) {
    if (!p.data) continue;
    const sources = [
      { source: 'page text', text: p.data.text },
      ...p.data.hidden.map((h) => ({ source: h.kind, text: h.text })),
      { source: 'page title', text: p.data.meta.title },
      { source: 'meta description', text: p.data.meta.description },
      ...p.data.forms.flatMap((f) => f.fields.map((fl) => ({ source: 'form label', text: `${fl.label} ${fl.placeholder}` })))
    ];
    for (const { source, text } of sources) {
      if (!text) continue;
      for (let w of wordsOf(text)) {
        w = w.replace(/[’']s$/i, '').replace(/[’']$/, '');
        if (w.length < 3) continue;
        const lower = w.toLowerCase();
        if (custom.has(lower)) continue;
        // Odd capitals like "JOin" or "hoMe"; real camelCase brands go in customWords.
        if (/^[A-Z]{2,}[a-z]+$/.test(w) || /^[a-z]+[A-Z][A-Za-z]*$/.test(w)) {
          add(caps, w, p.url, source, snippetAround(text, w));
          continue;
        }
        if (/^[A-Z]+$/.test(w) && w.length <= 6) continue; // acronyms
        const ok = spell.correct(w) || spell.correct(lower) || spell.correct(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) ||
          (plain(w) !== w && (spell.correct(plain(w)) || spell.correct(plain(lower))));
        if (!ok) add(bad, w, p.url, source, snippetAround(text, w));
      }
    }
  }
  const findings = [];
  const sorted = [...bad.values()].sort((a, b) => b.pages.size - a.pages.size || a.word.localeCompare(b.word));
  sorted.forEach((e, i) => {
    const suggestions = i < 60 ? spell.suggest(e.word).slice(0, 3) : [];
    for (const page of e.pages) {
      findings.push({
        check: 'spelling',
        severity: cfg.severity.spelling,
        page,
        message: `Possible misspelling: "${e.word}"${suggestions.length ? ` (did you mean ${suggestions.map((s) => `"${s}"`).join(', ')}?)` : ''}`,
        detail: `${[...e.sources].join(', ')}: ${e.context}`,
        word: e.word
      });
    }
  });
  for (const e of caps.values()) {
    for (const page of e.pages) {
      findings.push({
        check: 'capitalization',
        severity: cfg.severity.capitalization,
        page,
        message: `Odd capitalization: "${e.word}"`,
        detail: `${[...e.sources].join(', ')}: ${e.context}`,
        word: e.word
      });
    }
  }
  return { findings, misspelled: sorted.map((e) => ({ word: e.word, count: e.count, pages: e.pages.size })) };
}

export function checkRepeats(pages) {
  const findings = [];
  for (const p of pages) {
    if (!p.data) continue;
    for (const m of p.data.text.matchAll(/\b([A-Za-z]{2,})[ \t]+\1\b/gi)) {
      if (SKIP_REPEATS.has(m[1].toLowerCase())) continue;
      findings.push({ check: 'repeated words', severity: 'warn', page: p.url, message: `Repeated word: "${m[0]}"`, detail: snippetAround(p.data.text, m[0]) });
    }
    const counts = new Map();
    for (const block of p.data.blocks) {
      for (const s of block.split(/(?<=[.!?])\s+/)) {
        const n = normalizeSpace(s).toLowerCase();
        if (n.length < 40) continue;
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    for (const [s, c] of counts) {
      if (c > 1) findings.push({ check: 'repeated sentences', severity: 'warn', page: p.url, message: `The same sentence appears ${c} times on this page`, detail: s.slice(0, 200) });
    }
  }
  return findings;
}

export function checkPlaceholders(pages, cfg) {
  const findings = [];
  const pats = cfg.placeholderPatterns.map((p) => toRegex(p, 'i'));
  for (const p of pages) {
    if (!p.data) continue;
    const all = [p.data.text, ...p.data.hidden.map((h) => h.text), p.data.meta.title, p.data.meta.description].join('\n');
    for (const r of pats) {
      const m = all.match(r);
      if (m) findings.push({ check: 'placeholder text', severity: 'fail', page: p.url, message: `Placeholder or template text: "${m[0]}"`, detail: snippetAround(all, m[0]) });
    }
    for (const e of p.data.emptyStates) {
      findings.push({ check: 'empty sections', severity: 'warn', page: p.url, message: `Empty collection message is showing: "${e.slice(0, 80)}"`, detail: 'A CMS list or cart is empty on the live page. Hide it when empty or fill it.' });
    }
  }
  return findings;
}

function parseDates(text) {
  const out = [];
  const monthRe = new RegExp(`\\b(${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi');
  for (const m of text.matchAll(monthRe)) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
    out.push({ raw: m[0], date: new Date(Number(m[3]), mi, Number(m[2])) });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) out.push({ raw: m[0], date: new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) });
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.push({ raw: m[0], date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) });
  return out;
}

export function checkStale(pages, cfg, now = new Date()) {
  const findings = [];
  const year = now.getFullYear();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const allow = cfg.allowedPastYearContexts.map((p) => toRegex(p, 'i'));
  const seasonal = (cfg.seasonal || []).map((s) => ({ ...s, re: toRegex(s.pattern, 'i') }));
  for (const p of pages) {
    if (!p.data) continue;
    const text = p.data.text;
    const lines = text.split(/\n+/);
    const flaggedYears = new Set();
    for (const line of lines) {
      for (const m of line.matchAll(/\b(20\d{2})\b/g)) {
        const y = Number(m[1]);
        if (y >= year) continue;
        if (allow.some((r) => r.test(line))) continue;
        // "2025-2026" season ranges that reach the current year are fine.
        if (new RegExp(`${y}\\s*[-/\\u2013]\\s*(${year}|${String(year).slice(2)})`).test(line)) continue;
        if (flaggedYears.has(y + line)) continue;
        flaggedYears.add(y + line);
        findings.push({ check: 'stale content', severity: 'warn', page: p.url, message: `Mentions a past year (${y})`, detail: normalizeSpace(line).slice(0, 200) });
      }
    }
    for (const d of parseDates(text)) {
      if (d.date < today && d.date.getFullYear() >= year - 1) {
        findings.push({ check: 'stale content', severity: 'warn', page: p.url, message: `Date already passed: "${d.raw}"`, detail: snippetAround(text, d.raw) });
      }
    }
    const month = now.getMonth() + 1;
    for (const s of seasonal) {
      if (s.months.includes(month)) continue;
      const m = text.match(s.re);
      if (m) findings.push({ check: 'out of season', severity: s.severity || 'warn', page: p.url, message: s.message || `Out-of-season content: "${m[0]}"`, detail: snippetAround(text, m[0]) });
    }
  }
  return findings;
}

export function checkContactDetails(pages, cfg) {
  const findings = [];
  const domains = (cfg.expectedEmailDomains || []).map((d) => d.toLowerCase());
  const phones = (cfg.expectedPhones || []).map((d) => d.replace(/\D/g, ''));
  const seen = new Set();
  for (const p of pages) {
    if (!p.data) continue;
    const emails = new Set();
    for (const m of p.data.text.matchAll(/\b[\w.+-]+@([\w-]+(?:\.[\w-]+)+)\b/g)) emails.add(m[0].toLowerCase());
    for (const l of p.data.links) if (/^mailto:/i.test(l.href)) emails.add(l.href.replace(/^mailto:/i, '').split('?')[0].toLowerCase());
    for (const email of emails) {
      const key = p.url + email;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) {
        findings.push({ check: 'contact details', severity: 'fail', page: p.url, message: `Malformed email address: ${email}` });
        continue;
      }
      const domain = email.split('@')[1];
      if (!domains.length || domains.includes(domain)) continue;
      const near = domains.find((d) => levenshtein(d, domain) <= 3);
      if (near) findings.push({ check: 'contact details', severity: 'fail', page: p.url, message: `Email domain looks like a typo: ${email} (expected ${near})` });
      else findings.push({ check: 'contact details', severity: 'info', page: p.url, message: `Email on an outside domain: ${email}` });
    }
    if (phones.length) {
      const found = new Set();
      for (const m of p.data.text.matchAll(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) found.add(m[0].replace(/\D/g, ''));
      for (const l of p.data.links) if (/^tel:/i.test(l.href)) found.add(l.href.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''));
      for (const ph of found) {
        if (!phones.includes(ph)) findings.push({ check: 'contact details', severity: 'warn', page: p.url, message: `Phone number not in the expected list: ${ph}` });
      }
    }
  }
  return findings;
}

export function checkRules(pages, cfg) {
  const findings = [];
  for (const rule of cfg.rules || []) {
    const pageRe = rule.pages ? toRegex(rule.pages, 'i') : null;
    const sev = rule.severity || 'fail';
    const label = rule.id ? `never-again: ${rule.id}` : 'never-again';
    let anyMatch = false;
    for (const p of pages) {
      if (!p.data) continue;
      if (pageRe && !pageRe.test(new URL(p.url).pathname)) continue;
      const allText = [p.data.text, ...p.data.hidden.map((h) => h.text), p.data.meta.title, p.data.meta.description].join('\n');
      if (rule.type === 'forbidText') {
        const m = allText.match(toRegex(rule.pattern, rule.flags || 'i'));
        if (m) findings.push({ check: label, severity: sev, page: p.url, message: rule.message || `Forbidden text: "${m[0]}"`, detail: snippetAround(allText, m[0]) });
      } else if (rule.type === 'requireText') {
        if (toRegex(rule.pattern, rule.flags || 'i').test(allText)) anyMatch = true;
        else if (!rule.anyPage) findings.push({ check: label, severity: sev, page: p.url, message: rule.message || `Required text missing: /${rule.pattern}/` });
      } else if (rule.type === 'forbidHref') {
        const re = toRegex(rule.pattern, rule.flags || 'i');
        const hits = p.data.links.filter((l) => re.test(l.href));
        for (const h of hits) findings.push({ check: label, severity: sev, page: p.url, message: rule.message || 'Forbidden link', detail: `"${h.text}" -> ${h.href}` });
      } else if (rule.type === 'forbidSelector') {
        const n = p.data.selectorHits[rule.selector] || 0;
        if (n > 0) findings.push({ check: label, severity: sev, page: p.url, message: rule.message || `${n} visible element(s) match ${rule.selector}` });
      } else if (rule.type === 'requireSelector') {
        const n = p.data.selectorHits[rule.selector] || 0;
        if (n <= 0) findings.push({ check: label, severity: sev, page: p.url, message: rule.message || `Nothing visible matches ${rule.selector}` });
      }
    }
    if (rule.type === 'requireText' && rule.anyPage && !anyMatch) {
      findings.push({ check: label, severity: sev, page: '(site)', message: rule.message || `No page contains /${rule.pattern}/` });
    }
  }
  return findings;
}
