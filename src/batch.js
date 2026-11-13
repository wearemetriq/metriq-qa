import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQa } from './run.js';
import { ensureDir, timestamp, escapeHtml as e, relPath } from './util.js';
import { looksLikeUrl } from './sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Works out what to check.
//   no inputs        every client in sites\ (the env given, live by default)
//   a .txt file      one address per line; "#" starts a comment; add --only after an address for one page
//   addresses        these addresses
export function resolveTargets(inputs, { sitesDir = path.join(ROOT, 'sites'), env = 'live' } = {}) {
  const targets = [];
  if (!inputs.length) {
    const files = fs.existsSync(sitesDir) ? fs.readdirSync(sitesDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort() : [];
    for (const file of files) {
      const full = path.join(sitesDir, file);
      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (err) {
        targets.push({ label: file, error: `Couldn't read sites/${file}: ${err.message}` });
        continue;
      }
      const name = cfg.name || file.replace(/\.json$/, '');
      const target = cfg.environments?.[env];
      if (!target?.url) {
        targets.push({ label: name, skipped: `No "${env}" address in sites/${file}` });
        continue;
      }
      targets.push({ label: name, config: full, env, url: target.url });
    }
    return targets;
  }

  for (const input of inputs) {
    if (looksLikeUrl(input)) {
      targets.push({ label: input, url: input });
    } else if (fs.existsSync(input) && fs.statSync(input).isFile()) {
      for (const raw of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        if (!line) continue;
        const [address, ...flags] = line.split(/\s+/);
        if (!looksLikeUrl(address)) {
          targets.push({ label: address, error: `Not a web address (in ${path.basename(input)})` });
          continue;
        }
        targets.push({ label: address + (flags.includes('--only') ? ' (one page)' : ''), url: address, only: flags.includes('--only') });
      }
    } else {
      targets.push({ label: input, error: 'Not a web address or a list file' });
    }
  }
  return targets;
}

// Runs each target in turn. One site failing to load never stops the rest.
export async function runBatch(targets, { out, runOptions = {}, sitesDir, log = (m) => console.log(m) } = {}) {
  const batchDir = ensureDir(path.resolve(out || path.join(ROOT, 'reports'), `batch-${timestamp()}`));
  const startedAt = new Date();
  const rows = [];

  for (const [i, t] of targets.entries()) {
    const head = `[${i + 1}/${targets.length}] ${t.label}`;
    if (t.skipped || t.error) {
      rows.push({ label: t.label, url: t.url, status: t.skipped ? 'skipped' : 'error', message: t.skipped || t.error });
      log(`${head}\n   ${t.skipped ? 'SKIPPED' : 'ERROR'}: ${t.skipped || t.error}`);
      continue;
    }
    log(head);
    const started = Date.now();
    try {
      const r = await runQa({
        ...runOptions,
        config: t.config,
        env: t.config ? t.env : undefined,
        url: t.config ? undefined : t.url,
        only: !!t.only,
        out: batchDir,
        sitesDir,
        quiet: true
      });
      const seconds = Math.round((Date.now() - started) / 1000);
      rows.push({
        label: t.label,
        url: t.url,
        status: r.pass ? 'pass' : 'fail',
        counts: r.counts,
        pages: r.pages.length,
        report: r.file,
        topFixes: topChecks(r.findings, 'fail'),
        topReviews: topChecks(r.findings, 'warn'),
        seconds
      });
      log(`   ${r.pass ? 'PASS' : 'FAIL'}: ${r.counts.fail} to fix, ${r.counts.warn} to review (${r.pages.length} pages, ${seconds}s)`);
    } catch (err) {
      rows.push({ label: t.label, url: t.url, status: 'error', message: String(err.message || err).slice(0, 300) });
      log(`   ERROR: ${String(err.message || err).split('\n')[0]}`);
    }
  }

  const summary = writeSummary(rows, batchDir, startedAt);
  const tally = (s) => rows.filter((r) => r.status === s).length;
  log('');
  log(`Batch: ${tally('pass')} passed, ${tally('fail')} failed, ${tally('error')} errors, ${tally('skipped')} skipped`);
  log(`Summary: ${summary}`);
  return { rows, batchDir, file: summary, allPass: rows.every((r) => r.status === 'pass' || r.status === 'skipped') };
}

// "spelling (12), broken links (3)": the checks with the most findings at one severity.
function topChecks(findings, severity, limit = 4) {
  const counts = new Map();
  for (const f of findings) if (f.severity === severity) counts.set(f.check, (counts.get(f.check) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([check, n]) => ({ check, n }));
}

const ORDER = { error: 0, fail: 1, pass: 2, skipped: 3 };

function writeSummary(rows, batchDir, startedAt) {
  fs.writeFileSync(path.join(batchDir, 'summary.json'), JSON.stringify({ startedAt, rows }, null, 2));
  const sorted = [...rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.counts?.fail || 0) - (a.counts?.fail || 0));
  const list = (items) => items?.length ? items.map((x) => `${e(x.check)} <span class="n">(${x.n})</span>`).join(', ') : '<span class="none">none</span>';
  const label = { pass: 'PASS', fail: 'FAIL', error: 'ERROR', skipped: 'SKIPPED' };
  const tr = sorted.map((r) => `<tr>
<td><strong>${e(r.label)}</strong>${r.url ? `<div class="detail"><a href="${e(/^https?:/i.test(r.url) ? r.url : 'https://' + r.url)}">${e(r.url)}</a></div>` : ''}</td>
<td><span class="badge ${r.status}">${label[r.status]}</span></td>
<td class="num f">${r.counts ? r.counts.fail : ''}</td>
<td class="num w">${r.counts ? r.counts.warn : ''}</td>
<td class="num">${r.pages ?? ''}</td>
<td>${r.message ? `<span class="detail">${e(r.message)}</span>` : `<div><b>Fix:</b> ${list(r.topFixes)}</div><div class="detail"><b>Review:</b> ${list(r.topReviews)}</div>`}</td>
<td>${r.report ? `<a href="${e(relPath(batchDir, r.report))}">Open report</a>` : ''}</td>
</tr>`).join('\n');
  const n = (s) => rows.filter((r) => r.status === s).length;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA batch: ${n('pass')} passed, ${n('fail') + n('error')} need attention</title>
<style>
:root{--ink:#1d1d1b;--quiet:#6b6b66;--line:#e4e2dc;--bg:#faf9f6;--fail:#b3261e;--warn:#9a6700;--pass:#1e7a3c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:1180px;margin:0 auto;padding:32px 24px 80px}h1{font-size:26px;margin:0 0 4px}.meta{color:var(--quiet);margin-bottom:20px}
.tally span{margin-right:18px;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line)}td,th{padding:10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
th{font-size:13px;color:var(--quiet);font-weight:600;white-space:nowrap}.num{text-align:right;width:70px}.f{color:var(--fail);font-weight:600}.w{color:var(--warn);font-weight:600}
.badge{display:inline-block;font-weight:700;font-size:13px;padding:3px 9px;border-radius:6px;color:#fff}
.badge.pass{background:var(--pass)}.badge.fail,.badge.error{background:var(--fail)}.badge.skipped{background:var(--quiet)}
.detail{color:var(--quiet);font-size:13px;word-break:break-word}.n{color:var(--quiet)}.none{color:var(--quiet)}a{color:#1a5fb4}
</style></head><body><main>
<h1>QA batch</h1>
<div class="meta">${e(startedAt.toLocaleString())} · ${rows.length} site${rows.length === 1 ? '' : 's'}</div>
<p class="tally"><span style="color:var(--pass)">${n('pass')} passed</span><span class="f">${n('fail')} failed</span><span class="f">${n('error')} errors</span><span class="n">${n('skipped')} skipped</span></p>
<table><thead><tr><th>Site</th><th>Result</th><th class="num">To fix</th><th class="num">To review</th><th class="num">Pages</th><th>Main problems</th><th></th></tr></thead>
<tbody>${tr}</tbody></table>
<p class="detail">Each site's full report is linked on the right. Hand a report folder to Claude to sort fixes into what it can do on staging, what needs client approval and what needs you.</p>
</main></body></html>`;
  const file = path.join(batchDir, 'summary.html');
  fs.writeFileSync(file, html);
  return file;
}
