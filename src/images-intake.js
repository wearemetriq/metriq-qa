import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ensureDir } from './util.js';

const INPUT = /\.(jpe?g|png|webp|tiff?|avif|gif)$/i;

// Prepares client photos before they go into any CMS:
// bakes in the phone's rotation, strips metadata, caps the size, converts to WebP or AVIF,
// and flags photos too small to look sharp.
export async function intakeImages(inDir, outDir, opts = {}) {
  const max = Number(opts.max || 2400);
  const minWidth = Number(opts.minWidth || 1600);
  const quality = Number(opts.quality || 80);
  const format = (opts.format || 'webp').toLowerCase();
  ensureDir(outDir);
  const files = walk(inDir).filter((f) => INPUT.test(f));
  const skipped = walk(inDir).filter((f) => /\.(heic|heif|dng|raw|cr2|nef)$/i.test(f));
  const rows = [['file', 'rotation_fixed', 'original', 'output', 'kb', 'note']];
  let warnings = 0;
  for (const file of files) {
    const meta = await sharp(file).metadata();
    const rotated = meta.orientation && meta.orientation > 1;
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const name = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
    const out = path.join(outDir, `${name}.${format}`);
    let pipeline = sharp(file).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
    pipeline = format === 'avif' ? pipeline.avif({ quality: Math.max(30, quality - 30) }) : format === 'jpg' || format === 'jpeg' ? pipeline.jpeg({ quality, mozjpeg: true }) : pipeline.webp({ quality });
    const info = await pipeline.toFile(out);
    const notes = [];
    if (info.width < minWidth) {
      notes.push(`only ${info.width}px wide; may look blurry in a wide slot`);
      warnings++;
    }
    if (info.size > 500 * 1024) notes.push('over 500 KB after compression');
    const origW = rotated && meta.orientation >= 5 ? meta.height : meta.width;
    const origH = rotated && meta.orientation >= 5 ? meta.width : meta.height;
    rows.push([path.relative(inDir, file), rotated ? 'yes' : 'no', `${origW}x${origH}`, `${info.width}x${info.height}`, Math.round(info.size / 1024), notes.join('; ')]);
    console.log(`${rotated ? 'rotated  ' : '         '}${path.basename(file)} -> ${path.basename(out)} ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB${notes.length ? '  WARNING: ' + notes.join('; ') : ''}`);
  }
  for (const s of skipped) {
    console.log(`skipped  ${path.basename(s)}: export HEIC or RAW photos as JPG first`);
    rows.push([path.relative(inDir, s), '', '', '', '', 'skipped: export as JPG first']);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  fs.writeFileSync(path.join(outDir, 'intake-report.csv'), csv);
  console.log(`\n${files.length} image(s) processed, ${warnings} too small, ${skipped.length} skipped. Report: ${path.join(outDir, 'intake-report.csv')}`);
  console.log('Next: have Claude look at the outputs for blur and awkward crops and write alt text for each.');
  return { processed: files.length, warnings, skipped: skipped.length };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
