import { chromium } from 'playwright';

// Try Playwright's own Chromium first, then the Chrome or Edge already on the machine.
// On Windows, Edge is always present, so the tool runs even before `npx playwright install`.
export async function launchBrowser() {
  const attempts = [
    process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : null,
    {},
    { channel: 'chrome' },
    { channel: 'msedge' }
  ].filter(Boolean);
  let lastErr;
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    'Could not start a browser. Run `npx playwright install chromium`, or install Chrome or Edge.\n' + (lastErr?.message || '')
  );
}
