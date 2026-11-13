# metriq-qa

A pre-publish QA gate for every metriq site. It checks the rendered site, so it works the same on Webflow, WordPress, a local build, or anything else with a URL. Nothing goes to a client, and nothing goes live, until it passes.

Each run crawls the site, runs about 30 automated checks, takes screenshots at phone, tablet and desktop widths, and writes a report with a PASS or FAIL at the top. It also writes a brief for Claude to proofread the copy and look at every screenshot, since that's where wrong-but-real words ("reviewing out FAQ") and sideways photos get caught.

## What it checks

| Check | What it catches | Real example it would have caught |
| --- | --- | --- |
| Spelling and capitals | Typos in visible text, alt text, titles, meta descriptions, form labels and placeholders; odd capitals like "JOin" | "JOin our newsletter" on the Mud Hen homepage |
| Repeats | Doubled words, the same sentence twice on a page | Jen's repeated line on the homepage (May 2026) |
| Placeholder text | Lorem ipsum, Webflow default text, TODO, [insert], empty CMS lists showing "No items found" | Template leftovers |
| Stale content | Past years, dates that already passed, seasonal promos out of season | Last year's camp flyer left up (Feb 2026) |
| Contact details | Email domains one typo away from the real one, phone numbers not on the approved list | The wrong email on the Homeschool page (Jul 2026) |
| Never-again rules | Anything you add per client: banned phrases, banned link styles, required text | "Arizona" in the waiver |
| Navigation | The same menu item twice, menu links to "#", menus that differ between pages | Pottery Painting twice; Open Studio linking to "#" |
| Buttons | The same button twice back to back | Duplicate buttons (Dec 2025) |
| Links | Broken internal and outside links | Old page links |
| Booking links | Fragile link styles (Acuity category links), booking pages that load broken; screenshots of every booking page | Links breaking after Acuity category renames |
| Images | Blurry (stretched beyond its pixels), stretched or squashed, heavily cropped, missing alt text, placeholder images, files over 500 KB, and photos that store their rotation in metadata | The sideways class photos (Nov 2026), the blurry Paint Your Own Pottery photo (Jan 2026) |
| Layout | Pages that scroll sideways on phones | Fixed-width sections |
| Forms | Fields without labels, wrong field types, typos in field names, required fields that aren't required, no spam protection | Event form missing required name and phone (Sep 2025), "tyoe-of-funding" |
| SEO basics | Missing or duplicate titles, banned title patterns, missing descriptions, viewport, lang, Open Graph image, favicon; noindex left on a live site | "Current - Mud Hen Clay & Art Studio" CMS titles; WordPress "discourage search engines" left on at launch |
| Headings | No H1, several H1s, skipped levels | |
| Accessibility | axe-core WCAG 2.1 AA checks, including color contrast | |
| 404 page | Missing pages that don't return 404, unstyled 404 pages | The unstyled Mud Hen 404 |
| Visual changes | Pages that look different from the last approved screenshots | A shared component edit that quietly changed another page |
| Console errors | JavaScript errors on load | |

## Setup on Windows (one time)

Open PowerShell in the folder that holds `metriq-qa`:

```powershell
winget install OpenJS.NodeJS.LTS      # skip if `node -v` already shows v20 or newer
cd metriq-qa
npm install
npx playwright install chromium       # optional: without it, the tool uses Edge or Chrome
npm test                              # self-test against a site with 29 planted problems
```

## Everyday use

```powershell
# Before sending a staging link to a client
node bin/metriq-qa.js run --config sites/mudhen.json --env staging

# After a small edit, check just the pages you touched
node bin/metriq-qa.js run --config sites/mudhen.json --env staging --pages /,/events

# Right after publishing, confirm the live site
node bin/metriq-qa.js run --config sites/mudhen.json --env live

# A local build folder (static export, dist/)
node bin/metriq-qa.js run --serve C:\path\to\dist

# A local dev server or WordPress on Local
node bin/metriq-qa.js run --url http://localhost:3000
node bin/metriq-qa.js run --url http://mysite.local

# Once you've reviewed a run and it looks right, approve its screenshots as the new reference
node bin/metriq-qa.js run --config sites/mudhen.json --env staging --update-baseline
```

The report opens from `reports\<site>-<env>-<time>\report.html`. The process exits with code 0 on PASS and 1 on FAIL, so it can block a deploy script or a scheduled task.

The rule: anything under "Fix before sending" gets fixed and re-run before a client sees the site. "Review" items get a look. Then do the AI review.

## The AI review step

Each run writes `ai-review.md` plus a `text\` folder (every page's copy, alt text, labels and buttons) and a `screens\` folder. Ask Claude to run the review: it proofreads every text file for wrong words and grammar a spell checker can't see, then looks at every screenshot for sideways, blurry or badly cropped photos, empty sections, overlaps and anything that shows at one width but not another. Its findings get added to the gate decision.

## Adding a client

```powershell
node bin/metriq-qa.js init clientname https://clientname.webflow.io
```

Then open `sites\clientname.json` and fill in what you know:

- `environments`: staging and live URLs. For a local build use `"serve": "../path/to/dist"`. For a staging site behind basic auth add `"httpCredentials": { "username": "${STAGING_USER}", "password": "${STAGING_PASS}" }`; values in `${...}` come from environment variables, so passwords never sit in the file.
- `customWords`: names, product names and trade terms the spell checker should accept. Each run's report lists unknown words with a copy button.
- `expectedEmailDomains` and `expectedPhones`: the client's real contact details, so near-miss typos fail.
- `badTitlePatterns`: title text that must never ship, as regular expressions.
- `seasonal`: promos that should only show in certain months.
- `bookingLinks`: scheduling providers to render and screenshot, link styles to warn about, and text that means the booking page is broken.
- `forms`: which fields each form must require.
- `rules`: the client's never-again list (below).
- `ignoreSelectors`: page regions to skip, such as marquees that repeat text on purpose.

### Never-again rules

Every complaint a client sends becomes a rule within one business day, so it can't happen twice.

```json
{ "id": "waiver-state", "type": "forbidText", "pattern": "\\bArizona\\b", "severity": "fail", "message": "The waiver should cite California law." }
{ "id": "old-flyer", "type": "forbidHref", "pattern": "flyer.*\\.pdf", "severity": "warn", "message": "Check the flyer shows this season's dates." }
{ "id": "phone-in-footer", "type": "requireText", "pattern": "\\(714\\)", "pages": "^/$", "message": "Homepage must show the phone number." }
{ "id": "no-empty-cart", "type": "forbidSelector", "selector": ".w-commerce-commercecartemptystate", "severity": "warn" }
```

Types: `forbidText`, `requireText` (add `"anyPage": true` to require it somewhere on the site), `forbidHref`, `forbidSelector`, `requireSelector`. `pages` limits a rule to paths that match a regular expression. `severity` is `fail`, `warn` or `info`.

## Photo intake

Run every client photo through this before it goes into any CMS:

```powershell
node bin/metriq-qa.js images C:\path\to\client-photos C:\path\to\ready
```

It bakes the phone's rotation into the pixels (so no platform can show it sideways), strips metadata, caps the long side at 2,400 px, converts to WebP (`--format avif` or `jpg` also work), warns on anything under 1,600 px wide, and writes `intake-report.csv`. HEIC and RAW files are skipped with a note; export them as JPG first. Then ask Claude to look at the results for blur and awkward crops and write the alt text.

## Limits

- It checks what a visitor's browser receives. Webflow's password-protected staging uses a login form, not basic auth, so either remove the password while checking or check the published staging URL.
- It can't confirm form notification emails arrive, hover states and interactions feel right, or the copy sounds like the client. Those stay on the hand checklist.
- Background images set in CSS aren't checked for blur; the screenshot review catches those.
- Booking pages are rendered and screenshotted, but whether each one lands on the right class needs a look. Tune `brokenTextPatterns` once you've seen what a broken link looks like in each provider.
- Spelling uses US English.
- Outside-link checks can be blocked by sites that refuse automated requests. Those show as "review", not "fix", and social sites are skipped by default.
