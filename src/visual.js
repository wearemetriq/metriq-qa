import fs from 'node:fs';
import path from 'node:path';
import pngjs from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ensureDir } from './util.js';

const { PNG } = pngjs;

// Compares this run's screenshots with the last approved set.
// Approve a run with --update-baseline after you've reviewed it.
export function compareBaselines(pages, cfg, { baselineDir, outDir, update }) {
  const findings = [];
  const diffDir = ensureDir(path.join(outDir, 'diffs'));
  ensureDir(baselineDir);
  let compared = 0;
  for (const p of pages) {
    for (const [w, file] of Object.entries(p.screenshots || {})) {
      const base = path.join(baselineDir, path.basename(file));
      if (update) {
        fs.copyFileSync(file, base);
        continue;
      }
      if (!fs.existsSync(base)) continue;
      compared++;
      const a = PNG.sync.read(fs.readFileSync(base));
      const b = PNG.sync.read(fs.readFileSync(file));
      if (a.width !== b.width || Math.abs(a.height - b.height) > 4) {
        findings.push({
          check: 'visual changes',
          severity: 'warn',
          page: p.url,
          message: `Page at ${w}px changed height from ${a.height}px to ${b.height}px since the approved version`,
          detail: 'Expected if you edited this page. If not, a shared component or CMS item changed it.',
          screenshot: file
        });
        continue;
      }
      const h = Math.min(a.height, b.height);
      const crop = (img) => (img.height === h ? img.data : img.data.subarray(0, img.width * h * 4));
      const diff = new PNG({ width: a.width, height: h });
      const changed = pixelmatch(crop(a), crop(b), diff.data, a.width, h, { threshold: cfg.visual.diffThreshold });
      const ratio = changed / (a.width * h);
      if (ratio > cfg.visual.changedRatioWarn) {
        const diffFile = path.join(diffDir, path.basename(file));
        fs.writeFileSync(diffFile, PNG.sync.write(diff));
        findings.push({
          check: 'visual changes',
          severity: 'warn',
          page: p.url,
          message: `Page at ${w}px looks ${(ratio * 100).toFixed(1)}% different from the approved version`,
          detail: 'Red pixels in the diff image show what moved. Expected if you edited this page.',
          screenshot: diffFile
        });
      }
    }
  }
  return { findings, compared };
}
