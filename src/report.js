import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml as e, ensureDir, pathOf, relPath } from './util.js';

const SEV_ORDER = { fail: 0, warn: 1, info: 2 };

export function writeTextBundles(pages, outDir) {
  const dir = ensureDir(path.join(outDir, 'text'));
  for (const p of pages) {
    if (!p.data) continue;
    const d = p.data;
    const lines = [
      `# ${pathOf(p.url)}`,
      '',
      `URL: ${p.url}`,
      `Title: ${d.meta.title}`,
      `Meta description: ${d.meta.description}`,
      '',
      '## Headings',
      ...d.headings.map((h) => `${'  '.repeat(h.level - 1)}- H${h.level}: ${h.text}`),
      '',
      '## Visible text',
      d.text.trim(),
      '',
      '## Buttons',
      ...[...new Set(d.ctas.map((c) => c.text))].map((t) => `- ${t}`),
      '',
      '## Alt text, labels and other hidden text',
      ...d.hidden.filter((h) => h.text).map((h) => `- ${h.kind}: ${h.text}`),
      '',
      '## Forms',
      ...d.forms.flatMap((f) => [`- ${f.name} (action: ${f.action || 'none'})`, ...f.fields.map((x) => `  - ${x.label || '(no label)'} [name=${x.name}, type=${x.type}${x.required ? ', required' : ''}]${x.placeholder ? ` placeholder="${x.placeholder}"` : ''}`)])
    ];
    fs.writeFileSync(path.join(dir, `${p.slug}.md`), lines.join('\n'));
  }
  return dir;
}

export function writeAiReviewBrief(pages, outDir, meta) {
  const lines = [
    `# AI review brief: ${meta.site} (${meta.env})`,
    '',
    'The automated checks are done. These two jobs need judgment, so Claude does them next:',
    '',
    '1. Proofread every file in `text/`. Look for wrong words that spell checkers miss ("reviewing out FAQ"), grammar, repeated or contradictory info, wrong dates, prices or ages, and copy that reads as pasted in without care. Quote each problem exactly and give the fix.',
    '2. Look at every screenshot in `screens/` (phone, tablet and desktop). Flag sideways, upside-down, blurry, stretched or badly cropped photos (cut-off faces), placeholder images, empty or broken sections, overlapping text, duplicate buttons, and anything that appears at one width but not another. Also open the screenshots in `booking/` and confirm each one lands on the right class or category.',
    '',
    'Write the results as fail / warn items with the page and the exact fix, then add them to the gate decision: anything that would embarrass us in front of the client is a fail.',
    '',
    '## Pages',
    ...pages.map((p) => `- ${pathOf(p.url)}: text/${p.slug}.md, ${Object.keys(p.screenshots || {}).map((w) => `screens/${p.slug}-${w}.png`).join(', ')}`)
  ];
  fs.writeFileSync(path.join(outDir, 'ai-review.md'), lines.join('\n'));
}

export function writeReport({ findings, pages, outDir, meta, misspelled }) {
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.check.localeCompare(b.check) || String(a.page).localeCompare(String(b.page)));
  const counts = { fail: 0, warn: 0, info: 0 };
  findings.forEach((f) => counts[f.severity]++);
  const pass = counts.fail === 0;

  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify({ meta, counts, pass, findings, pages: pages.map(({ data, ...rest }) => ({ ...rest, title: data?.meta?.title })) }, null, 2));

  const link = (file) => (file ? relPath(outDir, file) : '');
  const pageLabel = (u) => (u.startsWith('(') ? e(u) : `<a href="${e(u)}" target="_blank">${e(pathOf(u))}</a>`);
  const group = (sev) => {
    const items = findings.filter((f) => f.severity === sev);
    if (!items.length) return '<p class="none">Nothing here.</p>';
    const byCheck = new Map();
    for (const f of items) byCheck.set(f.check, [...(byCheck.get(f.check) || []), f]);
    return [...byCheck.entries()].map(([check, list]) => `
      <h3>${e(check)} <span class="n">${list.length}</span></h3>
      <table><tbody>${list.map((f) => `
        <tr><td class="pg">${pageLabel(f.page)}</td><td>${e(f.message)}${f.detail ? `<div class="detail">${e(f.detail)}</div>` : ''}${f.screenshot ? `<div><a href="${e(link(f.screenshot))}" target="_blank">screenshot</a></div>` : ''}${f.link ? `<div><a href="${e(f.link)}" target="_blank">how to fix</a></div>` : ''}</td></tr>`).join('')}
      </tbody></table>`).join('');
  };
  const pageRows = pages.map((p) => {
    const fs_ = findings.filter((f) => f.page === p.url);
    const c = (s) => fs_.filter((f) => f.severity === s).length;
    const shots = Object.entries(p.screenshots || {}).sort((a, b) => a[0] - b[0]).map(([w, f]) => `<a href="${e(link(f))}" target="_blank"><img src="${e(link(f))}" alt="${e(pathOf(p.url))} at ${w}px" loading="lazy"><span>${w}px</span></a>`).join('');
    return `<tr><td class="pg">${pageLabel(p.url)}<div class="detail">${e(p.data?.meta?.title || '')}</div></td><td>${p.status || '-'}</td><td class="f">${c('fail')}</td><td class="w">${c('warn')}</td><td><div class="shots">${shots}</div><a class="small" href="text/${e(p.slug)}.md" target="_blank">page text</a></td></tr>`;
  }).join('');
  const words = (misspelled || []).slice(0, 200);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA: ${e(meta.site)} (${e(meta.env)}) ${pass ? 'PASS' : 'FAIL'}</title>
<style>
:root{--ink:#1d1d1b;--quiet:#6b6b66;--line:#e4e2dc;--bg:#faf9f6;--fail:#b3261e;--warn:#9a6700;--pass:#1e7a3c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:1180px;margin:0 auto;padding:32px 24px 80px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 8px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:15px;margin:22px 0 6px}.n{color:var(--quiet);font-weight:400}.meta{color:var(--quiet)}
.gate{display:flex;gap:16px;align-items:center;margin:20px 0;padding:18px 20px;border-radius:10px;background:#fff;border:1px solid var(--line)}
.badge{font-weight:700;font-size:20px;padding:6px 14px;border-radius:8px;color:#fff;background:${pass ? 'var(--pass)' : 'var(--fail)'}}
.counts span{margin-right:18px}.f{color:var(--fail);font-weight:600}.w{color:var(--warn);font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}td,th{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
td.pg{width:24%;word-break:break-word}.detail{color:var(--quiet);font-size:13px;margin-top:2px;word-break:break-word}.none{color:var(--quiet)}
.shots{display:flex;gap:8px;flex-wrap:wrap}.shots a{display:flex;flex-direction:column;align-items:center;font-size:12px;color:var(--quiet);text-decoration:none}
.shots img{width:110px;height:140px;object-fit:cover;object-position:top left;border:1px solid var(--line);border-radius:4px}.small{font-size:12px}
details{margin-top:8px}summary{cursor:pointer;font-weight:600}code,pre{font:13px/1.4 ui-monospace,Consolas,monospace}pre{background:#fff;border:1px solid var(--line);padding:10px;border-radius:6px;white-space:pre-wrap}
a{color:#1a5fb4}
</style></head><body><main>
<h1>${e(meta.site)}: pre-publish QA</h1>
<div class="meta">${e(meta.env)} · <a href="${e(meta.url)}">${e(meta.url)}</a> · ${e(meta.when)} · ${pages.length} pages${meta.notCrawled ? ` (${meta.notCrawled} more not checked; raise maxPages)` : ''}</div>
<div class="gate"><div class="badge">${pass ? 'PASS' : 'FAIL'}</div><div class="counts"><span class="f">${counts.fail} to fix before sending</span><span class="w">${counts.warn} to review</span><span>${counts.info} notes</span></div></div>
<p>${pass ? 'No blocking problems found by the automated checks. Finish the AI review (ai-review.md) before sending to the client.' : 'Fix every item in the first section, re-run, and only then send this to the client.'}</p>
<h2>Fix before sending</h2>${group('fail')}
<h2>Review</h2>${group('warn')}
<h2>Notes</h2><details><summary>${counts.info} notes</summary>${group('info')}</details>
<h2>Pages</h2><table><thead><tr><th>Page</th><th>Status</th><th>Fix</th><th>Review</th><th>Screenshots</th></tr></thead><tbody>${pageRows}</tbody></table>
${words.length ? `<h2>Words the spell checker didn't know</h2><p>Real words (names, brand terms) go in <code>customWords</code> in the site config so they stop flagging. Everything else is a typo.</p>
<table><thead><tr><th>Word</th><th>Times</th><th>Pages</th></tr></thead><tbody>${words.map((w) => `<tr><td>${e(w.word)}</td><td>${w.count}</td><td>${w.pages}</td></tr>`).join('')}</tbody></table>
<details><summary>Copy as a customWords list</summary><pre>${e(JSON.stringify(words.map((w) => w.word)))}</pre></details>` : ''}
<h2>Still to do by hand</h2><p>Run the AI review in <code>ai-review.md</code> (proofreading for wrong words and a look at every screenshot), then check the items no script can: does the copy sound like the client, did we use their photos, do interactions and hover states work on the real domain, and do form notifications reach the right inboxes.</p>
</main></body></html>`;
  const file = path.join(outDir, 'report.html');
  fs.writeFileSync(file, html);
  return { file, counts, pass };
}
