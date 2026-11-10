#!/usr/bin/env node
//
// tools/lead-scout.js — find local practices whose websites are dated.
//
//   node tools/lead-scout.js --city "Austin,Texas,United States"
//   node tools/lead-scout.js --city "Leander,Texas,United States" \
//                            --trade chiropractor --trade "eye doctor" \
//                            --depth 40 --out leads
//
// WHAT COMES OUT: out/leads.html — a ranked page, worst site first, each with
// a phone screenshot and the specific, checkable reasons it scored.
//
//
// THE FILTERS, IN ORDER, AND WHY EACH DROPS WHAT IT DROPS
//
//   has a website     a practice with none is a different (easier) pitch and
//                     fails the email condition by definition
//   reachable         a dead domain is not a lead
//   SHOWS AN EMAIL    Edwin's condition: he writes to them by hand, so a
//                     practice with only a contact form is no use to him
//   scored > 0        a genuinely good site is not a lead either
//
// THE TOOL NEVER RECORDS AN EMAIL ADDRESS. It records whether one is on the
// page and WHICH page, and the report links there. Reading it is a human
// opening a contact page, which is what it would have been anyway.
//
//
// WHAT IT COSTS. $0.002 per city/trade search at DataForSEO. Six searches is
// about a cent. Fetching the practices' own sites is free, and paced — see
// GAP_MS. The run prints the exact figure at the end.

'use strict';

/* THE SAME .env THE SERVER READS.
   server.js line 3 does this and every credential in the app comes from it,
   so a tool that did not was a tool that always reported the credentials
   missing — which is exactly how the first run of this went. Resolved from
   the project root rather than the shell's cwd, so it works from anywhere. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const { searchMaps } = require('../utils/leadScout/mapsSearch');
const { scanSite } = require('../utils/leadScout/scanSite');
const { siteKey, isChain } = require('../utils/leadScout/chains');
const { judgeDesign } = require('../utils/leadScout/judgeDesign');

const TRADES = ['chiropractor', 'physical therapist', 'eye doctor'];

/** Politeness. These are small practices on shared hosting. */
const GAP_MS = 700;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { cities: [], trades: [], depth: 40, outDir: 'leads', minScore: 0, keepChains: false, judge: true };

  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--city':     out.cities.push(next()); break;
      case '--trade':    out.trades.push(next()); break;
      case '--depth':    out.depth = Number(next()); break;
      case '--out':      out.outDir = next(); break;
      case '--min':      out.minScore = Number(next()); break;
      case '--chains':   out.keepChains = true; break;
      case '--no-judge': out.judge = false; break;
      case '--help':
      case '-h':         out.help = true; break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }

  if (!out.trades.length) out.trades = TRADES;
  return out;
}

const HELP = `
  lead-scout — local practices with dated websites

    --city  "Austin,Texas,United States"   repeatable, required
    --trade "chiropractor"                 repeatable (default: all three)
    --depth 40                             results per search (max 700)
    --min   0                              drop sites scoring under this on FACTS
                                           (the ranking is the design score, not this)
    --chains                               keep national chains (dropped by default)
    --no-judge                             skip the vision pass (no OpenAI calls)
    --out   leads                          output folder

  Needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD — the same credentials
  keyword research already uses.
`;

async function main() {
  const opt = parseArgs(process.argv.slice(2));

  if (opt.help || !opt.cities.length) {
    console.log(HELP);
    process.exit(opt.help ? 0 : 1);
  }

  /* CREDENTIALS ARE CHECKED BEFORE ANYTHING RUNS, NOT PER SEARCH.
     Caught per search, a missing login printed "FAILED" six times and then
     an empty report — which reads exactly like "there are no dated
     chiropractor sites in Austin". A check that cannot run must not look
     like a check that found nothing. */
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    throw new Error(
      'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set, so no search can run. ' +
      'They are the same credentials keyword research uses — load your .env, ' +
      'or run with them in front of the command.'
    );
  }

  const shotDir = path.join(opt.outDir, 'shots');
  fs.mkdirSync(shotDir, { recursive: true });

  // ---- 1. discovery ----
  const seen = new Set();
  const found = [];
  let costUsd = 0;
  let searches = 0, failedSearches = 0;

  for (const city of opt.cities) {
    for (const trade of opt.trades) {
      process.stdout.write(`  searching: ${trade} in ${city} ... `);
      searches++;

      let res;
      try {
        res = await searchMaps({ keyword: trade, location: city, depth: opt.depth });
      } catch (err) {
        failedSearches++;
        console.log(`FAILED — ${err.message}`);
        continue;
      }

      costUsd += res.costUsd;

      // THE SAME PRACTICE APPEARS UNDER SEVERAL TRADES. A clinic listed as
      // both "chiropractor" and "physical therapist" is one lead, not two,
      // and place_id is the only identifier that survives a renamed site.
      const fresh = res.businesses.filter(b => {
        const key = b.placeId || b.url || b.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const b of fresh) found.push({ ...b, trade, city });
      console.log(`${res.businesses.length} listed, ${fresh.length} new`);
    }
  }

  /* EVERY SEARCH FAILING IS NOT AN EMPTY RESULT. Writing a 0-lead report
     here would say "nothing matched" about a run that never asked. */
  if (failedSearches === searches) {
    throw new Error(
      `all ${searches} search(es) failed — see the messages above. No report ` +
      `was written, because an empty one would read as "no leads here".`
    );
  }

  if (failedSearches) {
    console.log(`\n  ${failedSearches} of ${searches} searches failed; the report covers the rest.`);
  }

  /* ---- one row per WEBSITE ----
     place_id made every branch its own lead, so h2health.com was scanned
     three times and reported three times. A multi-location LOCAL practice
     is still a good lead, so the listings are collapsed rather than
     discarded and the count is carried through to the report. */
  const bySite = new Map();
  let chainsDropped = 0;

  for (const b of found) {
    if (!b.url) continue;

    if (!opt.keepChains && isChain(b.url)) { chainsDropped++; continue; }

    const key = siteKey(b.url);
    if (!key) continue;

    const seenBefore = bySite.get(key);
    if (seenBefore) { seenBefore.locations++; continue; }

    bySite.set(key, { ...b, siteKey: key, locations: 1 });
  }

  const withSite = [...bySite.values()];
  const collapsed = found.filter(b => b.url).length - withSite.length - chainsDropped;

  console.log(`\n  ${found.length} practices, ${withSite.length} distinct website(s) to scan` +
              `\n  (${chainsDropped} chain listing(s) dropped, ${collapsed} duplicate listing(s) collapsed)\n`);

  // ---- 2. scan ----
  const leads = [];
  const dropped = { unreachable: 0, noEmail: 0, decentSite: 0 };

  for (const [i, b] of withSite.entries()) {
    process.stdout.write(`  [${i + 1}/${withSite.length}] ${b.domain || b.url} ... `);

    const scan = await scanSite(b.url, { shotDir });
    await sleep(GAP_MS);

    if (!scan.reachable)        { dropped.unreachable++; console.log(`unreachable (${scan.error})`); continue; }
    if (!scan.hasEmail)         { dropped.noEmail++;     console.log('no email on the site — skipped'); continue; }
    if (scan.score < opt.minScore) { dropped.decentSite++; console.log(`below --min (${scan.score})`); continue; }

    leads.push({ ...b, ...scan });
    console.log(`LEAD — ${scan.score}/${scan.max}`);
  }

  /* ---- the vision pass ----
     THE FACTUAL SCORE NO LONGER SORTS THE LIST, and that is the point of
     this change. A run over 77 Austin practices found not one site missing
     a viewport tag: the markup signals cannot separate "generic template"
     from "good", because the difference is not in the markup. So the
     screenshots are graded and THAT is the sort key; scoreSite's reasons
     stay on as the evidence for the email. */
  let judged = 0, unjudged = 0, promptTokens = 0, completionTokens = 0;

  if (opt.judge && leads.length) {
    console.log(`\n  judging ${leads.length} screenshot(s)...`);

    for (const lead of leads) {
      if (!lead.desktopShot) { unjudged++; continue; }

      const verdict = await judgeDesign({
        desktopShot: lead.desktopShot,
        mobileShot: lead.shot,
        businessName: lead.title,
        trade: lead.trade,
      });

      if (!verdict || verdict.error) {
        unjudged++;
        console.log(`    ${lead.siteKey}: could not judge${verdict ? ` — ${verdict.error}` : ''}`);
        continue;
      }

      lead.design = verdict;
      judged++;
      promptTokens += verdict.usage?.prompt_tokens || 0;
      completionTokens += verdict.usage?.completion_tokens || 0;

      console.log(`    ${String(verdict.score).padStart(2)}/10  ${lead.siteKey}  (${verdict.era})`);
    }
  }

  /* Judged sites first, worst-looking at the top. Unjudged ones fall to the
     bottom on their factual score rather than being silently scored 0 —
     a site nobody looked at is not a site that passed. */
  leads.sort((a, b) => {
    const ad = a.design ? a.design.score : -1;
    const bd = b.design ? b.design.score : -1;
    if (ad !== bd) return bd - ad;
    return b.score - a.score;
  });

  // ---- 3. report ----
  const file = path.join(opt.outDir, 'leads.html');
  fs.writeFileSync(file, renderReport(leads, { dropped, costUsd, opt, scanned: withSite.length,
                                              judged, unjudged, promptTokens, completionTokens }));

  console.log(`\n  ${leads.length} lead(s). Dropped: ${dropped.noEmail} with no email, ` +
              `${dropped.unreachable} unreachable, ${dropped.decentSite} with a decent site.`);
  console.log(`  DataForSEO cost: $${costUsd.toFixed(4)}`);
  if (judged) {
    console.log(`  Vision pass: ${judged} judged, ${unjudged} not. ` +
                `${promptTokens.toLocaleString()} prompt + ${completionTokens.toLocaleString()} completion tokens.`);
  }
  console.log(`  Report: ${path.resolve(file)}\n`);

  if (leads.some(l => !l.measured)) {
    console.log('  Note: some sites were not rendered, so the phone-overflow check');
    console.log('  did not run on them. `npm i -D playwright && npx playwright install chromium`\n');
  }
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderReport(leads, { dropped, costUsd, opt, scanned, judged = 0, unjudged = 0, promptTokens = 0, completionTokens = 0 }) {
  const rows = leads.map((l, i) => `
    <article class="lead">
      <div class="rank">${i + 1}</div>
      <div class="shot">${l.shot
        ? `<img src="${esc(path.relative(opt.outDir, l.shot))}" alt="${esc(l.title)} on a phone" loading="lazy">`
        : '<div class="noshot">no screenshot<br><small>Playwright not installed</small></div>'}</div>
      <div class="body">
        <h2>${esc(l.title)}</h2>
        <p class="meta">
          <a href="${esc(l.finalUrl)}" target="_blank" rel="noopener">${esc(l.domain || l.finalUrl)}</a>
          ${l.phone ? ` · ${esc(l.phone)}` : ''}
          ${l.rating != null ? ` · ${l.rating}★ (${l.votes ?? 0})` : ''}
        </p>
        <p class="meta">${esc(l.trade)} · ${esc(l.address || l.city)}${
          l.locations > 1 ? ` · <strong>${l.locations} locations</strong>` : ''}</p>
        ${l.design ? `
        <p class="design"><span class="dscore">${l.design.score}/10</span>
           <span class="era">${esc(l.design.era)}</span></p>
        <p class="verdict">${esc(l.design.verdict)}</p>
        <ul class="obs">${l.design.observations.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
        ` : '<p class="design unjudged">not judged</p>'}

        <details class="facts">
          <summary>${l.reasons.length} checkable fact${l.reasons.length === 1 ? '' : 's'} for the email
                   · ${l.score}/${l.max}${l.measured ? '' : ' · not rendered'}</summary>
          <ul class="why">${l.reasons.map(r => `<li>${esc(r)}</li>`).join('')
            || '<li>nothing technically wrong with it</li>'}</ul>
        </details>
        <p class="email">Email is on
          <a href="${esc(l.emailPage)}" target="_blank" rel="noopener">${esc(l.emailPage)}</a>
          <span class="how">(${esc(l.how)})</span>
        </p>
      </div>
    </article>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lead scout — ${leads.length} leads</title>
<style>
  :root{--navy:#0f1733;--brand:#6d3df5;--line:rgba(15,23,51,.12)}
  *{box-sizing:border-box}
  body{margin:0;padding:32px 24px 72px;background:#eef0f3;color:var(--navy);
       font:16px/1.5 -apple-system,"Helvetica Neue",Arial,sans-serif}
  header{max-width:1000px;margin:0 auto 28px}
  h1{font-size:26px;margin:0 0 6px}
  .summary{color:#5a6070;font-size:15px;margin:0}
  .lead{max-width:1000px;margin:0 auto 16px;background:#fff;border:1px solid var(--line);
        border-radius:14px;padding:20px;display:grid;
        grid-template-columns:44px 150px 1fr;gap:20px;align-items:start}
  .rank{font-size:26px;font-weight:800;color:var(--brand);line-height:1}
  .shot img{width:150px;border-radius:8px;border:1px solid var(--line);display:block}
  .noshot{width:150px;height:200px;border:1px dashed var(--line);border-radius:8px;
          display:flex;align-items:center;justify-content:center;text-align:center;
          color:#8a90a0;font-size:12px;padding:8px}
  h2{font-size:19px;margin:0 0 4px}
  .meta{margin:0 0 4px;font-size:14px;color:#5a6070}
  .meta a{color:var(--brand)}
  .design{margin:12px 0 4px;display:flex;align-items:baseline;gap:10px}
  .dscore{font-size:22px;font-weight:800;color:var(--brand)}
  .era{font-size:13px;color:#8a90a0}
  .design.unjudged .dscore,.design.unjudged{color:#8a90a0;font-size:14px;font-weight:600}
  .verdict{margin:0 0 8px;font-size:15.5px;color:#3f4552}
  .obs{margin:0 0 10px;padding-left:18px;font-size:14px;color:#5a6070}
  .obs li{margin-bottom:2px}
  .facts{margin:8px 0 0;font-size:13.5px;color:#5a6070}
  .facts summary{cursor:pointer;color:var(--brand)}
  .score{margin:10px 0 6px;font-weight:700}
  .why{margin:0;padding-left:18px;font-size:14.5px;color:#3f4552}
  .why li{margin-bottom:3px}
  .email{margin:12px 0 0;font-size:14px}
  .email a{color:var(--brand)}
  .how{color:#8a90a0}
  @media (max-width:700px){.lead{grid-template-columns:1fr}.shot img,.noshot{width:100%}}
</style></head><body>
<header>
  <h1>${leads.length} lead${leads.length === 1 ? '' : 's'}</h1>
  <p class="summary">
    ${esc(opt.cities.join(' · '))} — ${esc(opt.trades.join(', '))}.
    Scanned ${scanned} distinct sites. Skipped ${dropped.noEmail} with no email on the page,
    ${dropped.unreachable} unreachable, ${dropped.decentSite} scoring under ${opt.minScore}.
    DataForSEO cost $${costUsd.toFixed(4)}.${judged
      ? ` ${judged} graded by eye${unjudged ? `, ${unjudged} not` : ''};
          ${(promptTokens + completionTokens).toLocaleString()} tokens.`
      : ' No vision pass — ranked on technical signals only.'}
    <br><strong>Sorted by how dated the page looks, not by the technical score.</strong>
  </p>
</header>
${rows || '<p style="max-width:1000px;margin:0 auto">Nothing matched. Try another city, or --min 0.</p>'}
</body></html>`;
}

if (require.main === module) {
  main().catch(err => { console.error(`\n  ${err.message}\n`); process.exit(1); });
}

module.exports = { parseArgs, renderReport };
