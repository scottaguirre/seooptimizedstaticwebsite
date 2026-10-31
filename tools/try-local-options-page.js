#!/usr/bin/env node
//
// tools/try-local-options-page.js
//
// Write ONE Local Website Options service page and show it. Nothing is
// saved, nothing is deployed, no credits are charged — this is not the
// generator, it is a way to read the prose before building anything on top
// of it.
//
//     node tools/try-local-options-page.js
//     node tools/try-local-options-page.js --service "Drain Cleaning" --index 1
//     node tools/try-local-options-page.js --all    six pages, ~16 cents
//     node tools/try-local-options-page.js --site   THE WHOLE SITE, ~19 cents
//
// --site IS THE ONE THAT TESTS ANYTHING. The others build pages by hand in
// this file; --site goes through generateLocalOptionsSite(), which is what
// the wizard and the deploy path will call. It exercises the chain rather
// than a rehearsal of it.
//
// WHY THIS EXISTS. Everything built for this mode so far proves the SHAPE is
// right — eleven pages, the ring, the rotation, the schema, 120 assertions.
// None of it touches whether a service page SOUNDS different from the main
// generator, which is the premise the whole mode rests on:
//
//   Edwin, 26 October: "What I'm looking is these sites look and sound
//   different from the ones we already generate."
//
// Half of that is now demonstrated and half is assumed. One call answers it
// for about a cent, before the wizard and the GitHub deploy path are built
// on top.
//
// READS OPENAI_API_KEY FROM .env, the same as the app. The key is never
// printed, and neither is anything derived from it.

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { getOpenAI } = require('../utils/openaiClient');
const { parseModelJson } = require('../utils/parseModelJson');
const { servicePagePrompt, WORDS } = require('../utils/localOptions/prompt');

const MODEL = process.env.BLOG_MODEL || 'gpt-5.6-terra';

/* The same six the mock-up used, so the output is comparable to the sample
 * site already on disk. */
const SERVICES = [
  'Water Heater Repair and Replacement',
  'Drain Cleaning',
  'Leak Detection',
  'Toilet Repair',
  'Sewer Line Repair',
  'Whole House Repiping',
];

const BUSINESS = {
  name: 'Leander Plumbing Gomanzo',
  trade: 'plumbing',
  city: 'Leander',
  state: 'TX',
  street: '1804 S Bagdad Rd, Suite 120',
  zip: '78641',
  phone: '(512) 555-0164',
};

const AREAS = ['Leander', 'Cedar Park', 'Liberty Hill', 'north Austin'];

const HOURS = [
  { day: 'Monday', open: '7:00 AM – 6:00 PM' },
  { day: 'Tuesday', open: '7:00 AM – 6:00 PM' },
  { day: 'Wednesday', open: '7:00 AM – 6:00 PM' },
  { day: 'Thursday', open: '7:00 AM – 6:00 PM' },
  { day: 'Friday', open: '7:00 AM – 5:00 PM' },
  { day: 'Saturday', open: '8:00 AM – 1:00 PM' },
  { day: 'Sunday', open: null },
];

/* From utils/pricing.js's own measurement, 27 October. Printed so the cost
 * of reading this page is visible rather than guessed at. */
const PER_MILLION = { input: 2.00, output: 12.00 };

function arg(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const next = process.argv[at + 1];
  return next && !next.startsWith('--') ? next : true;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function words(page) {
  return (page.sections || [])
    .flatMap(s => s.paragraphs || [])
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

async function writeOne(name, index) {
  const service = { slug: slugify(name), name };

  const { system, user, stance } = servicePagePrompt({
    business: BUSINESS,
    service,
    index,
    areas: AREAS,
    hours: HOURS,
    siblings: SERVICES.filter(s => s !== name),
  });

  const started = Date.now();

  const answer = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const raw = answer.choices[0].message.content;

  /* parseModelJson RETURNS { ok, data, repaired, error } — NOT THE OBJECT.
   *
   * The first version of this file used the return value as the page. Every
   * field came back undefined, the word count printed 0, and the tool
   * reported "SHORT" about a page the model had actually written correctly
   * and this script had thrown away. It cost 3.5 cents to find out, and the
   * only reason it was found at all is that `undefined` is visible.
   *
   * So the shape is checked rather than assumed, and a failure prints the
   * model's own words instead of a row of blanks. */
  const parsed = parseModelJson(raw, { label: `${name} page` });

  if (!parsed.ok) {
    console.error(`\nThe model's JSON did not parse: ${parsed.error && parsed.error.message}`);
    console.error('\n--- what it actually sent ---\n');
    console.error(raw);
    throw new Error('unparseable response');
  }

  const page = parsed.data;

  const missing = ['h1', 'title', 'meta', 'blurb', 'sections']
    .filter(key => undefined === page[key]);

  if (missing.length) {
    console.error(`\nThe JSON parsed but is missing: ${missing.join(', ')}`);
    console.error('\n--- what it actually sent ---\n');
    console.error(raw);
    throw new Error('response is the wrong shape');
  }

  const usage = answer.usage || {};
  const cost = ((usage.prompt_tokens || 0) / 1e6) * PER_MILLION.input
    + ((usage.completion_tokens || 0) / 1e6) * PER_MILLION.output;

  return { service, page, stance, usage, cost, seconds, raw };
}

function show({ service, page, stance, usage, cost, seconds }) {
  const line = '='.repeat(72);

  console.log(`\n${line}`);
  console.log(`${service.name}   [stance: ${stance}]`);
  console.log(line);

  console.log(`\nH1     ${page.h1}`);
  console.log(`TITLE  ${page.title}  (${String(page.title || '').length} chars)`);
  console.log(`META   ${page.meta}  (${String(page.meta || '').length} chars)`);
  console.log(`BLURB  ${page.blurb}`);

  for (const section of page.sections || []) {
    console.log(`\n${section.heading ? `## ${section.heading}` : '## (opening)'}\n`);
    for (const paragraph of section.paragraphs || []) {
      console.log(`${paragraph}\n`);
    }
  }

  const n = words(page);
  const band = n < WORDS.min ? ' — SHORT' : n > WORDS.max ? ' — LONG' : '';

  console.log('-'.repeat(72));
  console.log(`${n} words${band}   ${seconds}s   `
    + `${usage.prompt_tokens || 0} in / ${usage.completion_tokens || 0} out`
    + `${usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens
      ? ` (${usage.completion_tokens_details.reasoning_tokens} reasoning)` : ''}`
    + `   $${cost.toFixed(4)}`);
}

/**
 * The whole site, through the real generator.
 *
 * --all BUILDS SIX PAGES BY HAND IN THIS FILE. This goes through
 * generateLocalOptionsSite(), which is what the wizard and the deploy path
 * will call — so it exercises the chain rather than a rehearsal of it: the
 * six prompts, the home prompt, the shape checks, the renderer, the ring,
 * the rotation, the schema and the pictures.
 *
 * SEVEN CALLS, ABOUT TWENTY CENTS. Nothing is deployed and no credits are
 * charged; the files land in builds/ to be read.
 */
async function wholeSite() {
  const { generateLocalOptionsSite } = require('../utils/localOptions/generate');

  const started = Date.now();

  const { files, services, heroes, usage } = await generateLocalOptionsSite({
    business: BUSINESS,
    url: 'https://example.invalid',
    serviceNames: SERVICES,
    areas: AREAS,
    hours: HOURS,
    now: new Date(),
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const cost = (usage.inputTokens / 1e6) * PER_MILLION.input
    + (usage.outputTokens / 1e6) * PER_MILLION.output;

  const out = path.join(__dirname, '..', 'builds', 'localoptions-preview');

  fs.rmSync(out, { recursive: true, force: true });

  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(out, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }

  const line = '='.repeat(72);

  console.log(`\n${line}`);
  console.log(`${Object.keys(files).length} files   ${usage.calls} calls   `
    + `${seconds}s   $${cost.toFixed(4)}`);
  console.log(line);

  for (const service of services) {
    const n = (service.sections || [])
      .flatMap(s => s.paragraphs || []).join(' ').split(/\s+/).filter(Boolean).length;
    const band = n < WORDS.min ? 'SHORT' : n > WORDS.max ? 'LONG' : '';

    console.log(`  ${String(n).padStart(4)} words  [${service.stance.padEnd(22)}] `
      + `${service.name}${band ? `  — ${band}` : ''}`);
  }

  if (heroes.missing.length) {
    console.log(`\n  heroes missing: ${heroes.missing.join(', ')}`);
  }

  /* THE OPENINGS, SIDE BY SIDE — the check nothing else does. Six pages
   * sharing one shape is six pages at risk of one opening. */
  console.log('\nFIRST SIX WORDS OF EACH OPENING:\n');
  for (const service of services) {
    const first = ((service.sections || [])[0] || {}).paragraphs || [];
    console.log(`  ${String(first[0] || '').split(/\s+/).slice(0, 6).join(' ')}...`);
  }

  console.log(`\nwritten to ${out}`);
  console.log('Serve it rather than opening the file directly — the pages link');
  console.log('/assets/site.css, which from a file:// URL resolves to the disk root:');
  console.log(`\n  cd ${out} && python3 -m http.server 8099\n`);
}

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. It is read from .env, like the app.');
    process.exit(1);
  }

  if (arg('site')) return wholeSite();

  const all = Boolean(arg('all'));
  const only = arg('service');
  const index = Number(arg('index', 0)) || 0;

  const jobs = all
    ? SERVICES.map((name, i) => [name, i])
    : [[only && 'string' === typeof only ? only : SERVICES[index % SERVICES.length], index]];

  const done = [];

  for (const [name, i] of jobs) {
    const result = await writeOne(name, i);
    show(result);
    done.push(result);
  }

  if (done.length > 1) {
    const total = done.reduce((sum, d) => sum + d.cost, 0);

    console.log(`\n${'='.repeat(72)}`);
    console.log(`${done.length} pages   $${total.toFixed(4)} total   `
      + `$${(total / done.length).toFixed(4)} each`);

    /* THE OPENINGS, SIDE BY SIDE. Six pages sharing one shape is six pages
     * at risk of sharing one opening — the dupOpenings problem crossCheck
     * exists for on the blog, with none of the machinery here. The first six
     * words are the whole key there, so they are what is printed. */
    console.log('\nFIRST SIX WORDS OF EACH OPENING:\n');
    for (const d of done) {
      const first = ((d.page.sections || [])[0] || {}).paragraphs || [];
      console.log(`  [${d.stance.padEnd(22)}] ${String(first[0] || '')
        .split(/\s+/).slice(0, 6).join(' ')}...`);
    }
  }

  if (arg('html')) {
    /* WRITTEN INTO THE SCRATCH FOLDER, NOT DEPLOYED. The point is to read
     * it in a browser with the real stylesheet, not to publish anything. */
    const { renderSite } = require('../utils/localOptions/render/renderSite');

    const services = done.map(d => ({
      slug: d.service.slug,
      name: d.service.name,
      blurb: d.page.blurb,
      h1: d.page.h1,
      title: d.page.title,
      meta: d.page.meta,
      sections: d.page.sections,
    }));

    const files = renderSite({
      url: 'https://example.invalid',
      business: BUSINESS,
      services,
      areas: AREAS,
      hours: HOURS,
      home: { h1: `Plumbing in ${BUSINESS.city}, ${BUSINESS.state}`, sub: '', title: '', meta: '' },
      now: new Date(),
    });

    const out = path.join(__dirname, '..', 'builds', 'localoptions-preview');

    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(out, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }

    console.log(`\nwritten to ${out}`);
    console.log('Serve it rather than opening the file directly — the pages link');
    console.log('/assets/site.css, which from a file:// URL resolves to the disk root:');
    console.log(`\n  cd ${out} && python3 -m http.server 8099\n`);
  }
})().catch(err => {
  console.error('\n' + (err && err.message ? err.message : err));
  process.exit(1);
});
