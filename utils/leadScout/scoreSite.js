// utils/leadScout/scoreSite.js
//
// How bad is this website, and can you say so out loud?
//
//   const { scoreSite } = require('./scoreSite');
//   scoreSite({ html, url, finalUrl, render })
//
// EVERY SIGNAL HERE IS A FACT, NOT A TASTE.
//
// The obvious way to build this is to show a screenshot to a model and ask
// whether the site looks dated. That produces a number nobody can act on and
// an email nobody can send: "our AI thinks your site is ugly" is not a
// sentence that wins work, and it cannot be defended if the owner disagrees.
//
// So every check below is something that is either true or false about the
// page, and every one of them produces a clause Edwin can put in the first
// line of an email:
//
//     "your site has no mobile viewport tag, so phones render it at desktop
//      width and zoom out — about 60% of your visitors"
//
// The owner can check that themselves in ten seconds and find it is true.
// That is the difference between a cold email that reads as spam and one
// that reads as somebody who looked.
//
//     A SCORE NOBODY CAN CHECK IS A SCORE NOBODY BELIEVES.
//
//
// WHY THERE IS NO PAGESPEED CALL
//
// It was the obvious addition and it is deliberately left out of v1: the API
// needs its own Google key, it rate-limits hard, and it adds a second or two
// per site. Everything below comes from markup already fetched and, when
// Playwright is present, one render that was happening anyway. Add PageSpeed
// later as another signal, not as the foundation.

'use strict';

/* Weights are the cost to the BUSINESS, not how ugly the thing looks. A site
 * that phones cannot read loses customers; a missing favicon does not. */
const SIGNALS = [
  {
    id: 'no-viewport',
    weight: 30,
    says: 'no mobile viewport — phones render it at desktop width',
    test: ({ html }) => !/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html),
  },
  {
    id: 'not-https',
    weight: 25,
    says: 'served over http, so browsers mark it "Not secure"',
    test: ({ finalUrl }) => /^http:/i.test(finalUrl || ''),
  },
  {
    id: 'overflows-on-phone',
    weight: 20,
    says: 'scrolls sideways on a phone',
    // Only when a render actually happened. An absent render is NOT a pass:
    // see `measured` below.
    test: ({ render }) => render && render.overflowsAt390 === true,
    needsRender: true,
  },
  {
    id: 'table-layout',
    weight: 18,
    says: 'laid out with HTML tables, a technique abandoned around 2010',
    // <table role="presentation"> is the email-template idiom and shows up in
    // embedded newsletter signup blocks, so it is not counted on its own.
    test: ({ html }) => {
      const tables = html.match(/<table\b[^>]*>/gi) || [];
      const layout = tables.filter(t => !/role\s*=\s*["']?(grid|table)/i.test(t));
      return layout.length >= 3;
    },
  },
  {
    id: 'ancient-tags',
    weight: 15,
    says: 'uses tags browsers dropped support for',
    test: ({ html }) => /<(font|center|marquee|blink|frameset)\b/i.test(html),
  },
  {
    id: 'flash',
    weight: 15,
    says: 'contains Flash content, which no browser has run since 2020',
    test: ({ html }) =>
      /<(object|embed)\b[^>]*(shockwave-flash|\.swf)/i.test(html) ||
      /\.swf["']/i.test(html),
  },
  {
    id: 'stale-copyright',
    weight: 12,
    says: null,   // filled in by describe(), it names the year
    test: ctx => staleCopyrightYear(ctx) !== null,
  },
  {
    id: 'no-description',
    weight: 10,
    says: 'no meta description, so Google writes its own snippet',
    test: ({ html }) => !/<meta[^>]+name\s*=\s*["']description["']/i.test(html),
  },
  {
    id: 'no-schema',
    weight: 10,
    says: 'no LocalBusiness markup, so search engines have to guess the basics',
    test: ({ html }) =>
      !/application\/ld\+json/i.test(html) && !/itemtype\s*=\s*["'][^"']*schema\.org/i.test(html),
  },
  {
    id: 'old-jquery',
    weight: 8,
    says: 'running jQuery 1.x, released over a decade ago',
    test: ({ html }) => /jquery[.-]?1\.\d+(\.\d+)?(\.min)?\.js/i.test(html),
  },
  {
    id: 'no-favicon',
    weight: 4,
    says: 'no favicon, so it shows as a blank page icon in every tab',
    test: ({ html }) => !/<link[^>]+rel\s*=\s*["'][^"']*icon/i.test(html),
  },
];

/** How old a copyright year has to be before it is worth mentioning. */
const STALE_AFTER_YEARS = 3;

/**
 * The year in a footer copyright line, when it is old enough to matter.
 * Returns null when there is none, or when it is current.
 */
function staleCopyrightYear({ html, now = new Date() }) {
  const thisYear = now.getFullYear();
  const years = [];

  // "© 2016", "&copy; 2016", "Copyright 2016", and ranges like "2008-2016"
  const re = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi;

  let m;
  while ((m = re.exec(html))) {
    const y = Number(m[1]);
    if (y >= 1995 && y <= thisYear) years.push(y);
  }

  if (!years.length) return null;

  // The NEWEST one. A page saying "© 2008-2024" is maintained; taking the
  // first match would have called it eight years stale.
  const newest = Math.max(...years);
  return thisYear - newest >= STALE_AFTER_YEARS ? newest : null;
}

function describe(signal, ctx) {
  if (signal.id === 'stale-copyright') {
    const year = staleCopyrightYear(ctx);
    return `footer still says © ${year}`;
  }
  return signal.says;
}

/**
 * @param {object} ctx
 * @param {string} ctx.html       the homepage markup
 * @param {string} ctx.finalUrl   after redirects — http vs https is read here
 * @param {object} [ctx.render]   optional Playwright facts: { overflowsAt390 }
 * @param {Date}   [ctx.now]      injectable, so the copyright test is stable
 *
 * @returns {{score: number, max: number, reasons: string[], ids: string[],
 *            measured: boolean}}
 *
 * `score` is "how bad", 0 to max. Higher is a better lead.
 *
 * `measured` is false when no render was supplied, meaning the phone-overflow
 * check could not run. A missing render must never read as a passing one —
 * the score is then out of a smaller max, and the caller can say so rather
 * than quietly comparing it against sites that were fully checked.
 */
function scoreSite(ctx) {
  const html = String(ctx.html || '');
  const full = { ...ctx, html };
  const measured = Boolean(ctx.render);

  const applicable = SIGNALS.filter(s => measured || !s.needsRender);

  const hit = applicable.filter(s => {
    try { return s.test(full); }
    catch { return false; }   // a broken page must not break the run
  });

  return {
    score: hit.reduce((n, s) => n + s.weight, 0),
    max: applicable.reduce((n, s) => n + s.weight, 0),
    reasons: hit.map(s => describe(s, full)),
    ids: hit.map(s => s.id),
    measured,
  };
}

module.exports = { scoreSite, staleCopyrightYear, SIGNALS, STALE_AFTER_YEARS };
