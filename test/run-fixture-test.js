// Builds the test images, runs the QA tool against the fixture site with planted problems,
// and checks that each planted problem is caught and the clean About page stays clean.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { runQa } from '../src/run.js';
import { intakeImages } from '../src/images-intake.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, 'fixture-site');
const IMG = path.join(SITE, 'img');

async function makeImages() {
  const solid = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } });
  await solid(1600, 1200, '#b98b5e').jpeg().toFile(path.join(IMG, 'clean.jpg'));
  await solid(200, 150, '#6b8f71').jpeg().toFile(path.join(IMG, 'tiny.jpg'));
  await solid(900, 600, '#8a6f9e').jpeg().toFile(path.join(IMG, 'no-alt.jpg'));
  // A landscape photo saved with "rotate 90" in its metadata, the way phones save portrait shots.
  await solid(1200, 800, '#c7a26b').jpeg().withMetadata({ orientation: 6 }).toFile(path.join(IMG, 'rotated.jpg'));
  // A noisy photo saved at high quality so it weighs well over 500 KB.
  const w = 1800, h = 1400;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toFile(path.join(IMG, 'heavy.jpg'));
}

const config = {
  name: 'fixture',
  environments: { local: { serve: SITE, type: 'staging' } },
  exclude: ['^/booking/'],
  customWords: [],
  expectedEmailDomains: ['mudhenclayandart.com'],
  badTitlePatterns: ['^Current\\s*-'],
  seasonal: [{ pattern: 'summer camp', months: [1, 2, 3, 4, 5, 6, 7, 8], message: 'Summer camp content outside camp season' }],
  bookingLinks: [{
    match: '/booking/',
    warnPatterns: [{ pattern: 'appointmentType=category(%3A|:)', message: 'Category link breaks when the category is renamed' }],
    brokenTextPatterns: ['no appointment types']
  }],
  forms: [{ match: 'event', required: ['name', 'email', 'phone'] }],
  rules: [{ id: 'waiver-state', type: 'forbidText', pattern: '\\bArizona\\b', severity: 'fail', message: 'Mentions Arizona' }],
  checks: { externalLinks: false }
};

const EXPECT = [
  ['typo "teh"', (f) => f.check === 'spelling' && f.word === 'teh'],
  ['odd capitals "JOin"', (f) => f.check === 'capitalization' && f.word === 'JOin'],
  ['repeated sentence', (f) => f.check === 'repeated sentences'],
  ['past year 2025', (f) => f.check === 'stale content' && /2025/.test(f.message)],
  ['summer camp out of season', (f) => f.check === 'out of season'],
  ['email domain typo', (f) => f.check === 'contact details' && /typo/.test(f.message)],
  ['placeholder text', (f) => f.check === 'placeholder text'],
  ['never-again rule (Arizona)', (f) => f.check === 'never-again: waiver-state'],
  ['duplicate nav item', (f) => f.check === 'duplicates' && /Navigation shows "Classes"/.test(f.message)],
  ['dead "#" link in nav', (f) => f.check === 'dead links' && /Open Studio/.test(f.message)],
  ['dead "#" link in footer', (f) => f.check === 'dead links' && /HOME/.test(f.message)],
  ['back-to-back buttons', (f) => f.check === 'duplicates' && /back to back/.test(f.message)],
  ['broken internal link', (f) => f.check === 'broken links' && /does-not-exist/.test(f.detail || '')],
  ['blurry image', (f) => f.check === 'images' && /^Blurry: tiny/.test(f.message)],
  ['missing alt text', (f) => f.check === 'images' && /no alt text: no-alt/.test(f.message)],
  ['stretched image', (f) => f.check === 'images' && /Stretched or squashed: clean/.test(f.message)],
  ['rotation stored in metadata', (f) => f.check === 'images' && /rotated\.jpg stores its rotation/.test(f.message)],
  ['placeholder image', (f) => f.check === 'images' && /Placeholder image/.test(f.message)],
  ['heavy image', (f) => f.check === 'images' && /Heavy image: heavy/.test(f.message)],
  ['bad CMS-style title', (f) => f.check === 'seo basics' && /banned pattern/.test(f.message)],
  ['missing meta description', (f) => f.check === 'seo basics' && /Missing meta description/.test(f.message)],
  ['sideways scroll on phones', (f) => f.check === 'layout' && /390px/.test(f.message)],
  ['required form field optional', (f) => f.check === 'forms' && /"Name" should be required/.test(f.message)],
  ['form field name typo', (f) => f.check === 'forms' && /tyoe/.test(f.message)],
  ['email field wrong type', (f) => f.check === 'forms' && /looks like an email field/.test(f.message)],
  ['fragile booking category link', (f) => f.check === 'booking links' && /Category link/.test(f.message)],
  ['broken booking page', (f) => f.check === 'booking links' && f.severity === 'fail' && /looks broken/.test(f.message)],
  ['404 status', (f) => f.check === '404 page'],
  ['skipped heading level', (f) => f.check === 'headings' && /H1 to H3/.test(f.message)]
];

await makeImages();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metriq-qa-test-'));
const cfgFile = path.join(tmp, 'fixture.json');
fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));

const result = await runQa({ config: cfgFile, env: 'local', out: path.join(tmp, 'reports'), now: '2026-11-13T12:00:00', quiet: true });

let failures = 0;
for (const [label, test] of EXPECT) {
  const ok = result.findings.some(test);
  if (!ok) failures++;
  console.log(`${ok ? 'caught ' : 'MISSED '} ${label}`);
}
const aboutNoise = result.findings.filter((f) => /\/about$/.test(f.page) && f.severity !== 'info' && !['navigation consistency', 'duplicates', 'dead links', 'accessibility'].includes(f.check));
console.log(`\nClean About page: ${aboutNoise.length ? aboutNoise.length + ' unexpected finding(s)' : 'no false alarms'}`);
aboutNoise.forEach((f) => console.log(`   ${f.severity} ${f.check}: ${f.message}`));
if (aboutNoise.length) failures++;
if (result.pass) { console.log('Gate should FAIL on this site but passed'); failures++; }
else console.log('Gate correctly FAILED');

// Image intake: the rotated photo should come out upright, and the tiny one should be flagged.
const outImgs = path.join(tmp, 'intake');
const intake = await intakeImages(IMG, outImgs, {});
const rot = await sharp(path.join(outImgs, 'rotated.webp')).metadata();
const upright = rot.width === 800 && rot.height === 1200 && !rot.orientation;
console.log(`\nIntake: rotated photo ${upright ? 'baked upright (800x1200, no rotation tag)' : `NOT fixed (${rot.width}x${rot.height}, orientation ${rot.orientation})`}`);
console.log(`Intake: ${intake.warnings} small image warning(s)`);
if (!upright || intake.warnings < 1) failures++;

console.log(`\nReport: ${result.file}`);
console.log(failures ? `\n${failures} check(s) did not behave as expected` : '\nAll checks behaved as expected');
process.exit(failures ? 1 : 0);
