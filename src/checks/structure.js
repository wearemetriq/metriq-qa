import { toRegex } from '../util.js';

export function checkPageHealth(pages) {
  const findings = [];
  for (const p of pages) {
    if (p.loadError) findings.push({ check: 'page load', severity: 'fail', page: p.url, message: 'Page failed to load', detail: p.loadError });
    else if (p.status >= 400) findings.push({ check: 'page load', severity: 'fail', page: p.url, message: `Page returned HTTP ${p.status}` });
    if (p.consoleErrors?.length) {
      findings.push({ check: 'console errors', severity: 'warn', page: p.url, message: `${p.consoleErrors.length} JavaScript error(s) in the console`, detail: p.consoleErrors.slice(0, 3).join(' | ') });
    }
  }
  return findings;
}

export function checkMeta(pages, cfg, envType) {
  const findings = [];
  const bad = (cfg.badTitlePatterns || []).map((p) => toRegex(p, 'i'));
  const titles = new Map();
  let anyOg = false;
  let anyFavicon = false;
  for (const p of pages) {
    if (!p.data) continue;
    const m = p.data.meta;
    if (m.ogImage) anyOg = true;
    if (m.favicon) anyFavicon = true;
    if (!m.title) findings.push({ check: 'seo basics', severity: 'fail', page: p.url, message: 'Missing page title' });
    else {
      titles.set(m.title, [...(titles.get(m.title) || []), p.url]);
      const hit = bad.find((r) => r.test(m.title));
      if (hit) findings.push({ check: 'seo basics', severity: 'fail', page: p.url, message: `Page title matches a banned pattern: "${m.title}"` });
      if (m.title.length > 65) findings.push({ check: 'seo basics', severity: 'info', page: p.url, message: `Title is ${m.title.length} characters; search results cut off around 60` });
    }
    if (!m.description) findings.push({ check: 'seo basics', severity: 'warn', page: p.url, message: 'Missing meta description' });
    if (!m.viewport) findings.push({ check: 'seo basics', severity: 'fail', page: p.url, message: 'Missing viewport meta tag (the page will not scale on phones)' });
    if (!m.lang) findings.push({ check: 'seo basics', severity: 'warn', page: p.url, message: 'Missing lang attribute on <html>' });
    if (/noindex/i.test(m.robots)) {
      findings.push({
        check: 'seo basics',
        severity: envType === 'live' ? 'fail' : 'info',
        page: p.url,
        message: envType === 'live' ? 'Live page is set to noindex, so search engines will skip it' : 'Page is set to noindex (fine on staging, remove at launch)'
      });
    }
    if (envType === 'live' && m.canonical) {
      try {
        if (new URL(m.canonical, p.url).host !== new URL(p.url).host) {
          findings.push({ check: 'seo basics', severity: 'warn', page: p.url, message: `Canonical points to another domain: ${m.canonical}` });
        }
      } catch { /* ignore */ }
    }
    const h1s = p.data.headings.filter((h) => h.level === 1);
    if (h1s.length === 0) findings.push({ check: 'headings', severity: 'warn', page: p.url, message: 'No H1 on the page' });
    if (h1s.length > 1) findings.push({ check: 'headings', severity: 'warn', page: p.url, message: `${h1s.length} H1s on the page`, detail: h1s.map((h) => h.text).join(' | ').slice(0, 200) });
    let prev = 0;
    for (const h of p.data.headings) {
      if (prev && h.level > prev + 1) {
        findings.push({ check: 'headings', severity: 'info', page: p.url, message: `Heading level jumps from H${prev} to H${h.level}`, detail: h.text.slice(0, 120) });
        break;
      }
      prev = h.level;
    }
  }
  for (const [title, urls] of titles) {
    if (urls.length > 1) {
      for (const u of urls) findings.push({ check: 'seo basics', severity: 'warn', page: u, message: `Title is shared by ${urls.length} pages: "${title}"` });
    }
  }
  if (pages.length && !anyOg) findings.push({ check: 'seo basics', severity: 'warn', page: '(site)', message: 'No Open Graph image on any page (links shared on social will have no preview)' });
  if (pages.length && !anyFavicon) findings.push({ check: 'seo basics', severity: 'warn', page: '(site)', message: 'No favicon found' });
  return findings;
}

export function checkNavigation(pages) {
  const findings = [];
  const signatures = new Map();
  for (const p of pages) {
    if (!p.data) continue;
    const navLinks = p.data.links.filter((l) => l.inNav && l.visible && l.text);
    // Duplicate labels inside one menu container.
    const byContainer = new Map();
    for (const l of navLinks) {
      const key = `${l.container}|${l.text.toLowerCase()}`;
      byContainer.set(key, [...(byContainer.get(key) || []), l]);
    }
    for (const [, group] of byContainer) {
      if (group.length > 1) findings.push({ check: 'duplicates', severity: 'fail', page: p.url, message: `Navigation shows "${group[0].text}" ${group.length} times` });
    }
    // Links that go nowhere.
    for (const l of p.data.links.filter((x) => x.visible)) {
      const h = l.href.trim();
      if (h === '#' || h === '' || /^javascript:\s*(void\(0\);?)?$/i.test(h)) {
        const where = l.inNav ? 'navigation' : l.inFooter ? 'footer' : 'page';
        findings.push({
          check: 'dead links',
          severity: l.inNav || l.inFooter ? 'fail' : 'warn',
          page: p.url,
          message: `"${l.text || '(no text)'}" in the ${where} links to "${h || 'nothing'}"`
        });
      }
    }
    const sig = [...new Set(navLinks.filter((l) => !l.inFooter).map((l) => l.text.toLowerCase()))].sort().join(' | ');
    if (sig) signatures.set(p.url, sig);
  }
  // Header menu should match across pages.
  const counts = new Map();
  for (const s of signatures.values()) counts.set(s, (counts.get(s) || 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (common && signatures.size > 2) {
    const base = new Set(common.split(' | '));
    for (const [url, sig] of signatures) {
      if (sig === common) continue;
      const items = new Set(sig.split(' | '));
      const missing = [...base].filter((x) => !items.has(x));
      const extra = [...items].filter((x) => !base.has(x));
      findings.push({
        check: 'navigation consistency',
        severity: 'warn',
        page: url,
        message: 'Header menu differs from most pages',
        detail: `${missing.length ? 'missing: ' + missing.join(', ') : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? 'extra: ' + extra.join(', ') : ''}`
      });
    }
  }
  return findings;
}

export function checkCtas(pages) {
  const findings = [];
  for (const p of pages) {
    if (!p.data) continue;
    const ctas = p.data.ctas;
    for (let i = 1; i < ctas.length; i++) {
      if (ctas[i].text.toLowerCase() === ctas[i - 1].text.toLowerCase()) {
        findings.push({ check: 'duplicates', severity: 'warn', page: p.url, message: `Two "${ctas[i].text}" buttons back to back` });
      }
    }
    const tally = new Map();
    for (const c of ctas) tally.set(c.text.toLowerCase(), (tally.get(c.text.toLowerCase()) || 0) + 1);
    for (const [t, n] of tally) {
      if (n >= 4) findings.push({ check: 'duplicates', severity: 'info', page: p.url, message: `"${t}" button appears ${n} times on the page` });
    }
  }
  return findings;
}

export function checkLayout(pages) {
  const findings = [];
  for (const p of pages) {
    for (const [w, px] of Object.entries(p.overflow || {})) {
      if (px > 2) findings.push({ check: 'layout', severity: Number(w) < 800 ? 'fail' : 'warn', page: p.url, message: `Page scrolls sideways at ${w}px wide (${px}px too wide)` });
    }
  }
  return findings;
}

export function checkForms(pages, cfg, speller) {
  const findings = [];
  const specs = cfg.forms || [];
  for (const p of pages) {
    if (!p.data) continue;
    for (const f of p.data.forms) {
      if (!f.visible) continue;
      const label = `form "${f.name}"`;
      for (const fl of f.fields.filter((x) => x.visible)) {
        if (!fl.label) findings.push({ check: 'forms', severity: 'warn', page: p.url, message: `${label}: field "${fl.name || fl.placeholder || fl.type}" has no label`, detail: 'Screen readers and autofill rely on labels; a placeholder is not a label.' });
        const nm = `${fl.name} ${fl.label}`.toLowerCase();
        if (/e-?mail/.test(nm) && fl.type !== 'email') findings.push({ check: 'forms', severity: 'warn', page: p.url, message: `${label}: "${fl.name || fl.label}" looks like an email field but its type is "${fl.type}"` });
        if (/phone|mobile|\btel\b/.test(nm) && fl.type !== 'tel') findings.push({ check: 'forms', severity: 'info', page: p.url, message: `${label}: "${fl.name || fl.label}" looks like a phone field but its type is "${fl.type}"` });
        if (speller && fl.name) {
          for (const part of fl.name.split(/[-_\s]+|(?<=[a-z])(?=[A-Z])/)) {
            if (part.length < 4 || /\d/.test(part)) continue;
            if (!speller.custom.has(part.toLowerCase()) && !speller.spell.correct(part.toLowerCase())) {
              findings.push({ check: 'forms', severity: 'warn', page: p.url, message: `${label}: field name "${fl.name}" has a likely typo ("${part}")`, detail: 'Field names show up in notification emails and exports.' });
            }
          }
        }
      }
      if (!f.hasSpamProtection) findings.push({ check: 'forms', severity: 'info', page: p.url, message: `${label}: no reCAPTCHA, Turnstile or honeypot detected` });
      for (const spec of specs) {
        const re = toRegex(spec.match, 'i');
        if (!re.test(`${f.name} ${f.id} ${f.action}`)) continue;
        for (const req of spec.required || []) {
          const reqRe = toRegex(req, 'i');
          const field = f.fields.find((x) => reqRe.test(`${x.name} ${x.label} ${x.id}`));
          if (!field) findings.push({ check: 'forms', severity: 'fail', page: p.url, message: `${label}: required field "${req}" is missing from the form` });
          else if (!field.required) findings.push({ check: 'forms', severity: 'fail', page: p.url, message: `${label}: "${field.label || field.name}" should be required but is optional` });
        }
      }
    }
  }
  return findings;
}

export function checkA11y(pages, cfg) {
  const findings = [];
  for (const p of pages) {
    for (const v of p.axe || []) {
      const sev = v.impact === 'critical' ? cfg.severity.a11yCritical : v.impact === 'serious' ? cfg.severity.a11ySerious : 'info';
      findings.push({ check: 'accessibility', severity: sev, page: p.url, message: `${v.help} (${v.nodes} element${v.nodes === 1 ? '' : 's'}, ${v.impact})`, detail: v.targets.join(' | '), link: v.helpUrl });
    }
  }
  return findings;
}
