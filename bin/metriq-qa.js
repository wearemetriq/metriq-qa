#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { runQa, initSite, saveLogin } from '../src/run.js';
import { intakeImages } from '../src/images-intake.js';
import { looksLikeUrl } from '../src/sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `metriq-qa: pre-publish QA gate for any website

Usage
  metriq-qa <url>                                 check a whole site from any address
  metriq-qa <url> --only                          check just that one page
  metriq-qa login <url>                           sign in once (site password, WordPress login) so runs can see gated pages
  metriq-qa run --config sites/<client>.json [--env staging|live] [options]
  metriq-qa run --serve ./dist [options]          check a folder of built files
  metriq-qa images <inFolder> <outFolder> [--max 2400] [--min-width 1600] [--format webp|avif|jpg]
  metriq-qa init <client> <stagingUrl>            create sites/<client>.json from the template

If the URL belongs to a client with a sites/<client>.json, that client's rules are used automatically.

Run options
  --only                     check only the page in the URL, not the whole site
  --pages /,/about,/events   only check these paths (use after small edits)
  --max-pages 50             stop after this many pages
  --update-baseline          approve this run's screenshots as the new reference
  --no-a11y                  skip accessibility checks (faster)
  --no-external              skip checking links to other sites
  --no-screens               skip screenshots
  --no-open                  don't open the report when the run finishes
  --out <folder>             where reports go (default: reports/)
  --env-type live|staging    treat the target as live or staging (guessed from the address otherwise)

Exit code is 0 on PASS and 1 on FAIL, so it can block a deploy or a send step.`;

const FLAGS = new Set(['only', 'noOpen', 'noA11y', 'noExternal', 'noScreens', 'updateBaseline', 'help']);

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (FLAGS.has(key) || next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

const args = parse(process.argv.slice(2));
let cmd = args._[0];
// "metriq-qa https://site.com" is shorthand for "metriq-qa run --url https://site.com".
if (looksLikeUrl(cmd)) {
  args.url = cmd;
  cmd = 'run';
} else if (cmd === 'run' && looksLikeUrl(args._[1]) && !args.url) {
  args.url = args._[1];
}

function openFile(file) {
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', `"${file}"`]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try {
    spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).unref();
  } catch { /* opening is a convenience only */ }
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

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
      only: !!args.only,
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
    if (!args.noOpen && process.stdout.isTTY) openFile(result.file);
    process.exit(result.pass ? 0 : 1);
  } else if (cmd === 'login') {
    const url = args._[1];
    if (!url) throw new Error('Usage: metriq-qa login <url>');
    const file = await saveLogin(url, {
      waitForEnter: () => waitForEnter('\nA browser window is open. Sign in there (site password or login), then come back here and press Enter... ')
    });
    console.log(`Saved sign-in to ${file}. Runs against this site will use it. Delete the file to sign out.`);
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
