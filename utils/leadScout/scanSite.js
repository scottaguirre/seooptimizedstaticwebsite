// utils/leadScout/scanSite.js
//
// Fetch one practice's website, decide whether it shows an email, and score
// how dated it is.
//
//   const { scanSite } = require('./scanSite');
//   await scanSite('https://austinspine.com', { shotDir: 'out/shots' });
//
// THE EMAIL IS A CONDITION, NOT A FIELD. This returns `hasEmail` and the
// PAGE it was found on. The address itself is never read out of
// findEmail.js and never stored. Edwin opens that page and reads it himself.
//
// WHY IT LOOKS AT MORE THAN THE HOME PAGE. Practices put the address on the
// contact page far more often than the home page, so checking only the
// homepage would reject most of the list for being unreachable when it is
// not. CONTACT_PATHS is tried in order and STOPS AT THE FIRST HIT — this is
// a yes/no question, and there is no reason to pull four pages off a small
// practice's server to answer it twice.
//
// PLAYWRIGHT IS OPTIONAL, ON PURPOSE. It is not in this project's
// package.json, and adding it there would break ./deploy.sh on a machine
// that has not run `npx playwright install` — CLAUDE.md records a whole
// deploy lost to a declared-but-missing dependency. So it is require()d
// lazily inside a try, and when it is absent the run still produces every
// markup-derived signal. What it does NOT do is pretend the phone-overflow
// check passed: scoreSite() scores an unmeasured site out of a smaller
// total and flags it.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { hasEmail } = require('./findEmail');
const { scoreSite } = require('./scoreSite');

/** Tried in order after the homepage. */
const CONTACT_PATHS = ['/contact', '/contact-us', '/contact.html', '/about', '/about-us'];

/** Long enough for a slow small-business host, short enough to get through a list. */
const TIMEOUT_MS = 15000;

/**
 * AN HONEST USER-AGENT. It names the business and a page explaining the
 * crawler, so an owner reading their logs can see who it was.
 *
 * It deliberately carries NO personal email address — a contact URL is the
 * right thing to publish in a header that lands in thousands of logs.
 */
const UA = 'ThreeCometsLeadScout/1.0 (+https://threecomets.com/crawler)';

async function getPage(url, { fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    });

    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/html/i.test(type)) {
      return { ok: false, status: res.status, finalUrl: res.url || url, html: '' };
    }

    return { ok: true, status: res.status, finalUrl: res.url || url, html: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One render, for the two things markup cannot tell you: whether the page
 * scrolls sideways on a phone, and what it actually looks like.
 *
 * Returns null when Playwright is not installed. Never throws — a missing
 * screenshot is not a reason to lose a lead.
 */
async function render(url, shotPath, desktopShotPath) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return null;   // not installed; see the note at the top
  }

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      userAgent: UA,
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.waitForTimeout(1200);   // let webfonts and hero images settle

    // THE PHONE TEST. A page wider than its own viewport is one the visitor
    // has to drag sideways to read, and owners almost never look.
    const overflowsAt390 = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    );

    if (shotPath) {
      fs.mkdirSync(path.dirname(shotPath), { recursive: true });
      await page.screenshot({ path: shotPath });
    }

    /* THE DESKTOP FOLD, AND IT IS WHAT THE MODEL GRADES.
       Viewport-height, not fullPage: a visitor decides whether a site looks
       current in about two seconds of the top of the page, and a full-page
       capture of a long practice site is mostly footer. It is also the
       difference between an image the model reads cheaply and one it does
       not. deviceScaleFactor 1 for the same reason — this is judging
       layout, colour and type, not reading small print. */
    if (desktopShotPath) {
      fs.mkdirSync(path.dirname(desktopShotPath), { recursive: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: desktopShotPath });
    }

    return { overflowsAt390, shot: shotPath || null, desktopShot: desktopShotPath || null };
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * @returns {{
 *   url, finalUrl, reachable, hasEmail, emailPage, how,
 *   score, max, reasons, measured, shot, error
 * }}
 *
 * `emailPage` is a URL, so the report can link straight to the page Edwin
 * needs to open. It is the closest this tool comes to the address, and it
 * is still only a page that has one.
 */
async function scanSite(url, { shotDir = null, fetchImpl = fetch } = {}) {
  const base = { url, finalUrl: url, reachable: false, hasEmail: false,
                 emailPage: null, how: null, score: 0, max: 0, reasons: [],
                 measured: false, shot: null, desktopShot: null, error: null };

  let home;
  try {
    home = await getPage(url, { fetchImpl });
  } catch (err) {
    return { ...base, error: err.name === 'AbortError' ? 'timed out' : err.message };
  }

  if (!home.ok) {
    return { ...base, finalUrl: home.finalUrl, error: `HTTP ${home.status}` };
  }

  // ---- the email condition ----
  let found = hasEmail(home.html);
  let emailPage = found.found ? home.finalUrl : null;

  /* RESOLVED AGAINST THE HOMEPAGE'S OWN DIRECTORY, not the domain root.
     Nearly every practice site is at the root, where the two are identical —
     but a clinic hosted at example.com/clinic/ would otherwise have every
     contact path sent to example.com/contact, which is somebody else's site
     or a 404. One request either way. */
  const siteRoot = found.found ? null : new URL('.', home.finalUrl).href;

  if (!found.found) {
    for (const p of CONTACT_PATHS) {
      let page;
      try { page = await getPage(new URL(p.replace(/^\//, ''), siteRoot).href, { fetchImpl }); }
      catch { continue; }

      if (!page.ok) continue;

      const hit = hasEmail(page.html);
      if (hit.found) { found = hit; emailPage = page.finalUrl; break; }
    }
  }

  // ---- the render, and the screenshot that is the actual pitch ----
  /* HOSTNAME PLUS A HASH OF THE FULL URL.
     The hostname alone collided: two practices sharing a domain, or the same
     host reached twice, wrote to one file and the second silently replaced
     the first — so a lead in the report showed a DIFFERENT practice's
     screenshot. Caught by two fixtures on 127.0.0.1 both rendering as the
     second one. A wrong screenshot is worse than none: it is the thing
     Edwin looks at before writing the email. */
  const shotPath = shotDir
    ? path.join(shotDir, `${new URL(home.finalUrl).hostname.replace(/[^a-z0-9.-]/gi, '_')}` +
                `-${crypto.createHash('sha1').update(home.finalUrl).digest('hex').slice(0, 8)}.png`)
    : null;

  const desktopShotPath = shotPath ? shotPath.replace(/\.png$/, '-desktop.png') : null;
  const rendered = await render(home.finalUrl, shotPath, desktopShotPath);

  // ---- the score ----
  const scored = scoreSite({
    html: home.html,
    finalUrl: home.finalUrl,
    render: rendered ? { overflowsAt390: rendered.overflowsAt390 } : undefined,
  });

  return {
    url,
    finalUrl: home.finalUrl,
    reachable: true,
    hasEmail: found.found,
    emailPage,
    how: found.how,
    score: scored.score,
    max: scored.max,
    reasons: scored.reasons,
    measured: scored.measured,
    shot: rendered ? rendered.shot : null,
    desktopShot: rendered ? rendered.desktopShot : null,
    error: null,
  };
}

module.exports = { scanSite, getPage, render, CONTACT_PATHS, UA, TIMEOUT_MS };
