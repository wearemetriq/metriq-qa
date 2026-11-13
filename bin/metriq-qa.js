#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQa, initSite } from '../src/run.js';
import { intakeImages } from '../src/images-intake.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `metriq-qa: pre-publish QA gate for any website

Usage
  metriq-qa run --config sites/<client>.json [--env staging|live] [options]
  metriq-qa run --url https://example.webflow.io [options]
  metriq-qa run --serve ./dist [options]          check a folder of built files
  metriq-qa images <inFolder> <outFolder> [--max 2400] [--min-width 1600] [--format webp|avif|jpg]
  metriq-qa init <client> <stagingUrl>            create sites/<client>.json from the template

Run options
  --pages /,/about,/events   only check these paths (use after small edits)
  --max-pages 50             stop after this many pages
  --update-baseline          approve this run's screenshots as the new reference
  --no-a11y                  skip accessibility checks (faster)
  --no-external              skip checking links to other sites
  --no-screens               skip screenshots
  --out <folder>             where reports go (default: reports/)
  --env-type live|staging    treat the target as live or staging

Exit code is 0 on PASS and 1 on FAIL, so it can block a deploy or a send step.`;

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

const args = parse(process.argv.slice(2));
const cmd = args._[0];

try {
  if (!cmd || args.help || cmd === 'help') {
    console.log(HELP);
    process.exit(0);
  }
  if (cmd === 'run') {
    const result = await runQa({
      config: args.config,
      env: args.env,
      url: args.url,
      serve: args.serve,
      pages: typeof args.pages === 'string' ? args.pages.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      maxPages: args.maxPages ? Number(args.maxPages) : undefined,
      updateBaseline: !!args.updateBaseline,
      noA11y: !!args.noA11y,
      noExternal: !!args.noExternal,
      noScreens: !!args.noScreens,
      out: args.out,
      envType: args.envType,
      now: args.now
    });
    process.exit(result.pass ? 0 : 1);
  } else if (cmd === 'images') {
    const [, inDir, outDir] = args._;
    if (!inDir || !outDir) throw new Error('Usage: metriq-qa images <inFolder> <outFolder>');
    await intakeImages(path.resolve(inDir), path.resolve(outDir), { max: args.max, minWidth: args.minWidth, format: args.format, quality: args.quality });
  } else if (cmd === 'init') {
    const [, name, url] = args._;
    if (!name || !url) throw new Error('Usage: metriq-qa init <client> <stagingUrl>');
    console.log(`Created ${initSite(name, url, path.join(ROOT, 'sites'))}`);
  } else {
    console.log(HELP);
    process.exit(2);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(2);
}
