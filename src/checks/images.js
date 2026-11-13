import exifr from 'exifr';
import { toRegex } from '../util.js';

const ORIENTATION_TEXT = {
  2: 'mirrored', 3: 'upside down', 4: 'flipped vertically', 5: 'rotated and mirrored', 6: 'rotated 90 degrees', 7: 'rotated and mirrored', 8: 'rotated 270 degrees'
};

export async function checkImages(pages, cfg, { request, imageBytes }) {
  const findings = [];
  const placeholder = cfg.placeholderImagePatterns.map((p) => toRegex(p, 'i'));
  const orientCache = new Map();
  const getOrientation = async (url) => {
    if (!/\.jpe?g(\?|$)/i.test(url)) return 1;
    if (orientCache.has(url)) return orientCache.get(url);
    let o = 1;
    try {
      const res = await request.get(url, { headers: { Range: 'bytes=0-131071' }, timeout: 20000 });
      if (res.ok()) o = (await exifr.orientation(await res.body())) || 1;
    } catch { o = 1; }
    orientCache.set(url, o);
    return o;
  };

  for (const p of pages) {
    if (!p.data) continue;
    const reported = new Set();
    for (const img of p.data.images) {
      const name = decodeURIComponent((img.rawSrc || img.src).split('/').pop().split('?')[0]).slice(0, 80);
      const key = img.src + img.w;
      if (reported.has(key)) continue;
      reported.add(key);

      if (img.complete && img.nw === 0 && img.src) {
        findings.push({ check: 'images', severity: 'fail', page: p.url, message: `Broken image: ${name}`, detail: img.src });
        continue;
      }
      if (placeholder.some((r) => r.test(img.src) || r.test(img.rawSrc) || r.test(img.alt || ''))) {
        findings.push({ check: 'images', severity: 'fail', page: p.url, message: `Placeholder image is showing: ${name}` });
      }
      const decorative = img.alt === '' || img.role === 'presentation' || img.ariaHidden;
      if (img.visible && img.alt === null) findings.push({ check: 'images', severity: 'fail', page: p.url, message: `Image has no alt text: ${name}` });
      else if (img.visible && decorative && img.w >= 200) findings.push({ check: 'images', severity: 'info', page: p.url, message: `Large image marked decorative (empty alt): ${name}`, detail: 'Fine for pure decoration; photos of classes and work should be described.' });
      else if (img.alt && /\.(jpe?g|png|webp|gif|avif)$|^(img|dsc|image|photo)[_ -]?\d+/i.test(img.alt.trim())) {
        findings.push({ check: 'images', severity: 'warn', page: p.url, message: `Alt text is a file name: "${img.alt}"` });
      }

      if (img.visible && img.w >= 120 && img.h >= 60 && img.nw > 0 && img.nh > 0) {
        const needed = Math.max(img.w / img.nw, img.h / img.nh); // CSS px per source px
        const scale = 1 / needed;                                  // source px per CSS px
        if (scale < 1) {
          findings.push({ check: 'images', severity: 'fail', page: p.url, message: `Blurry: ${name} is stretched to ${img.w}x${img.h} from ${img.nw}x${img.nh}`, detail: 'Upload a larger original.' });
        } else if (scale < cfg.image.minScaleWarn) {
          findings.push({ check: 'images', severity: 'warn', page: p.url, message: `Soft on high-res screens: ${name} (${img.nw}px wide shown at ${img.w}px)`, detail: 'Aim for at least twice the displayed width.' });
        }
        const srcRatio = img.nw / img.nh;
        const boxRatio = img.w / img.h;
        const mismatch = 1 - Math.min(srcRatio / boxRatio, boxRatio / srcRatio);
        if (img.fit === 'cover' && mismatch > cfg.image.cropWarn) {
          findings.push({ check: 'images', severity: 'warn', page: p.url, message: `Heavily cropped: ${name} loses ${Math.round(mismatch * 100)}% of the picture in its frame`, detail: 'Check that faces and the subject are still in view.' });
        } else if ((img.fit === 'fill' || !img.fit) && mismatch > cfg.image.stretchWarn) {
          findings.push({ check: 'images', severity: 'fail', page: p.url, message: `Stretched or squashed: ${name} is distorted by ${Math.round(mismatch * 100)}%`, detail: 'Set object-fit to cover, or match the frame to the photo shape.' });
        }
        if (srcRatio < 0.9 && boxRatio > 1.3 && img.fit === 'cover') {
          findings.push({ check: 'images', severity: 'info', page: p.url, message: `Portrait photo in a landscape frame: ${name}`, detail: 'Review the screenshot; this is where sideways or cut-off photos tend to show up.' });
        }
      }

      for (const u of new Set([img.src, img.rawSrc && new URL(img.rawSrc, p.url).toString()].filter(Boolean))) {
        const o = await getOrientation(u);
        if (o > 1) {
          findings.push({
            check: 'images',
            severity: 'warn',
            page: p.url,
            message: `${name} stores its rotation in metadata (${ORIENTATION_TEXT[o] || 'orientation ' + o})`,
            detail: 'Platforms that resize images (Webflow, WordPress) can drop this, so the photo shows sideways at some sizes. Re-export it upright with the image intake command.'
          });
          break;
        }
      }

      const bytes = imageBytes.get(img.src);
      if (bytes && bytes > cfg.image.maxKB * 1024) {
        findings.push({ check: 'images', severity: bytes > cfg.image.maxKB * 2048 ? 'fail' : 'warn', page: p.url, message: `Heavy image: ${name} is ${Math.round(bytes / 1024)} KB`, detail: `Keep images under ${cfg.image.maxKB} KB. Compress or convert to WebP or AVIF.` });
      }
    }
  }
  return findings;
}
