import fs from 'node:fs';
import path from 'node:path';

// Defaults apply to every site. A client config only needs to override what differs.
export const DEFAULTS = {
  name: 'site',
  environments: {},
  maxPages: 150,
  startPaths: ['/'],
  exclude: [],                 // regex strings matched against the path
  ignoreSelectors: [],         // elements whose text is skipped (marquees, embeds you don't control)
  viewports: [390, 768, 1440], // phone, tablet, desktop
  customWords: [],             // words the spell checker should accept (names, brand terms)
  expectedEmailDomains: [],    // e.g. ["mudhenclayandart.com"]; near misses are flagged as typos
  expectedPhones: [],          // digits only, e.g. ["7145551234"]
  badTitlePatterns: [],        // regex strings that must never appear in a <title>
  placeholderPatterns: [
    'lorem ipsum',
    'this is some text inside of a div block',
    '\\bTODO\\b',
    '\\bTBD\\b',
    '\\[(insert|placeholder|your)[^\\]]*\\]',
    'your (text|content|heading|title) here',
    '\\bsample text\\b',
    'heading goes here'
  ],
  placeholderImagePatterns: ['placeholder', 'webflow-badge'],
  allowedPastYearContexts: [
    'since \\d{4}', 'est(ablished|\\.)?\\s*(in\\s*)?\\d{4}', 'founded( in)? \\d{4}', '©', 'copyright', 'opened( in)? \\d{4}'
  ],
  seasonal: [],                // [{ pattern, months: [1..12], message }]
  rules: [],                   // never-again rules, see README
  bookingLinks: [],            // [{ match, warnPatterns: [{ pattern, message }], brokenTextPatterns: [] }]
  forms: [],                   // [{ match: "events", required: ["name","email","phone"] }]
  skipLinkCheck: ['instagram\\.com', 'facebook\\.com', 'linkedin\\.com', 'yelp\\.com', 'tiktok\\.com', 'x\\.com', 'twitter\\.com', 'pinterest\\.com', 'youtube\\.com', 'google\\.com/maps', 'goo\\.gl'],
  image: {
    maxKB: 500,
    minScaleWarn: 1.5,         // source pixels per CSS pixel below this is soft on retina screens
    upscaleWarn: 1.03,         // shown more than 3% bigger than the file: review
    upscaleFail: 1.15,         // shown more than 15% bigger than the file: blurry, fix
    cropWarn: 0.45,            // object-fit: cover cropping more than 45% of the image
    stretchWarn: 0.06          // object-fit: fill distorting the aspect ratio by more than 6%
  },
  visual: {
    diffThreshold: 0.1,
    changedRatioWarn: 0.005
  },
  severity: {
    spelling: 'warn',
    capitalization: 'warn',
    a11yCritical: 'fail',
    a11ySerious: 'warn'
  },
  checks: {
    a11y: true,
    externalLinks: true,
    screenshots: true,
    visualDiff: true,
    notFoundPage: true
  }
};

function expandEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] ?? '');
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v)]));
  }
  return value;
}

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && base && typeof base === 'object' && !Array.isArray(base)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return over === undefined ? base : over;
}

export function loadConfig(configPath) {
  let user = {};
  let configDir = process.cwd();
  if (configPath) {
    const abs = path.resolve(configPath);
    user = JSON.parse(fs.readFileSync(abs, 'utf8'));
    configDir = path.dirname(abs);
  }
  const cfg = deepMerge(DEFAULTS, expandEnv(user));
  // Placeholder and past-year lists add to the defaults instead of replacing them.
  if (user.extraPlaceholderPatterns) cfg.placeholderPatterns = [...DEFAULTS.placeholderPatterns, ...user.extraPlaceholderPatterns];
  cfg._configDir = configDir;
  return cfg;
}

export function loadWordList(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
}
