// Runs inside the page. Must stay self-contained: no imports, no outside variables.
export function extractPage({ ignoreSelectors, ruleSelectors }) {
  const ignored = (el) => ignoreSelectors.some((sel) => { try { return el.closest(sel); } catch { return false; } });
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

  // Visible text, minus ignored regions.
  let text = '';
  if (document.body) {
    text = document.body.innerText || '';
    if (ignoreSelectors.length) {
      const parts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const el = n.parentElement;
        if (!el || ignored(el) || !visible(el)) continue;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
        parts.push(n.textContent);
      }
      text = parts.join(' ');
    }
  }

  const blocks = [...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dd,dt,td,th')]
    .filter((e) => visible(e) && !ignored(e))
    .map((e) => clean(e.innerText))
    .filter((t) => t.length > 0);

  const hidden = [];
  document.querySelectorAll('img[alt]').forEach((i) => i.alt && hidden.push({ kind: 'alt text', text: i.alt }));
  document.querySelectorAll('[aria-label]').forEach((e) => hidden.push({ kind: 'aria-label', text: e.getAttribute('aria-label') }));
  document.querySelectorAll('[placeholder]').forEach((e) => hidden.push({ kind: 'placeholder', text: e.getAttribute('placeholder') }));
  document.querySelectorAll('[title]').forEach((e) => e.tagName !== 'IFRAME' && hidden.push({ kind: 'title attribute', text: e.getAttribute('title') }));
  document.querySelectorAll('input[type=submit][value], button[value]').forEach((e) => hidden.push({ kind: 'button value', text: e.value }));

  const meta = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) || '';
  const metaInfo = {
    title: document.title || '',
    description: meta('meta[name="description"]'),
    canonical: meta('link[rel="canonical"]', 'href'),
    ogImage: meta('meta[property="og:image"]'),
    ogTitle: meta('meta[property="og:title"]'),
    favicon: meta('link[rel~="icon"]', 'href'),
    lang: document.documentElement.getAttribute('lang') || '',
    robots: meta('meta[name="robots"]'),
    viewport: meta('meta[name="viewport"]')
  };

  // Group nav links by their nearest list or nav container so a separate mobile menu is not read as a duplicate.
  const containers = [];
  const containerId = (el) => {
    const c = el.closest('ul, ol, nav, [role="navigation"], .w-nav-menu, footer') || el.parentElement;
    let i = containers.indexOf(c);
    if (i < 0) { containers.push(c); i = containers.length - 1; }
    return i;
  };
  const links = [...document.querySelectorAll('a[href]')].map((a) => ({
    href: a.getAttribute('href') || '',
    abs: a.href,
    text: clean(a.innerText || a.getAttribute('aria-label') || a.querySelector('img')?.alt || ''),
    inNav: !!a.closest('nav, [role="navigation"], .w-nav, header'),
    inFooter: !!a.closest('footer, [class*="footer" i]'),
    container: containerId(a),
    visible: visible(a)
  }));

  const ctaSel = 'button, a[class*="button" i], a[class*="btn" i], [role="button"], input[type="submit"]';
  const ctas = [...document.querySelectorAll(ctaSel)]
    .filter((e) => visible(e) && !e.closest('nav, header, footer, form'))
    .map((e, order) => ({ order, text: clean(e.innerText || e.value || e.getAttribute('aria-label') || '') }))
    .filter((c) => c.text);

  const images = [...document.images].map((img) => {
    const r = img.getBoundingClientRect();
    const s = getComputedStyle(img);
    return {
      src: img.currentSrc || img.src,
      rawSrc: img.getAttribute('src') || '',
      alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
      role: img.getAttribute('role') || '',
      ariaHidden: img.getAttribute('aria-hidden') === 'true',
      nw: img.naturalWidth,
      nh: img.naturalHeight,
      w: Math.round(r.width),
      h: Math.round(r.height),
      fit: s.objectFit,
      complete: img.complete,
      visible: visible(img)
    };
  });

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(visible)
    .map((h) => ({ level: Number(h.tagName[1]), text: clean(h.innerText) }));

  const labelFor = (el) => {
    if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.innerText).join(' '));
    const by = el.getAttribute('aria-labelledby');
    if (by) return clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
    return clean(el.getAttribute('aria-label') || '');
  };
  const forms = [...document.forms].map((f, i) => ({
    index: i,
    id: f.id || '',
    name: f.getAttribute('name') || f.getAttribute('data-name') || f.id || `form ${i + 1}`,
    action: f.getAttribute('action') || '',
    method: (f.getAttribute('method') || 'get').toLowerCase(),
    visible: visible(f),
    hasSpamProtection: !!(
      f.querySelector('.g-recaptcha, [class*="recaptcha" i], .cf-turnstile, [name*="honeypot" i], [data-sitekey]') ||
      document.querySelector('iframe[src*="recaptcha"], iframe[src*="turnstile"], script[src*="recaptcha"], script[src*="turnstile"]')
    ),
    fields: [...f.elements]
      .filter((e) => !['hidden', 'submit', 'button', 'reset', 'image'].includes(e.type) && !['BUTTON', 'FIELDSET', 'OUTPUT', 'OBJECT'].includes(e.tagName))
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        type: e.type || '',
        name: e.getAttribute('name') || e.getAttribute('data-name') || '',
        id: e.id || '',
        required: !!e.required || e.getAttribute('aria-required') === 'true',
        label: labelFor(e),
        placeholder: e.getAttribute('placeholder') || '',
        visible: visible(e)
      }))
  }));

  const emptyStates = [...document.querySelectorAll('.w-dyn-empty, [class*="empty-state" i]')]
    .filter(visible)
    .map((e) => clean(e.innerText))
    .filter(Boolean);

  const selectorHits = {};
  for (const sel of ruleSelectors) {
    try { selectorHits[sel] = [...document.querySelectorAll(sel)].filter(visible).length; } catch { selectorHits[sel] = -1; }
  }

  return { text, blocks, hidden, meta: metaInfo, links, ctas, images, headings, forms, emptyStates, selectorHits };
}

// Scrolls through the page so lazy-loaded images and scroll animations fire before checks and screenshots.
export async function autoScroll(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    const max = Math.min(document.body?.scrollHeight || 0, 40000);
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
}
