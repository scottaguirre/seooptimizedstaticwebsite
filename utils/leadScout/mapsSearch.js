// utils/leadScout/mapsSearch.js
//
// "chiropractor" + "Austin,Texas,United States" -> the practices, with their
// websites and phone numbers.
//
//   const { searchMaps } = require('./mapsSearch');
//   await searchMaps({ keyword: 'chiropractor', location: 'Austin,Texas,United States' });
//
// THIS IS GOOGLE BUSINESS PROFILE DATA, FETCHED THE WAY IT IS MEANT TO BE.
// No scraping of Google, no Places key, no second vendor: DataForSEO already
// has credentials in this app for keyword volumes, and their Maps SERP
// endpoint answers exactly this question.
//
// Endpoint, fields and limits confirmed against
// docs.dataforseo.com/v3/serp/google/maps/live/advanced on 5 November 2026:
//
//     POST https://api.dataforseo.com/v3/serp/google/maps/live/advanced
//     keyword        required, <= 700 chars
//     location_name  "City,Region,Country" — or location_code/_coordinate
//     language_name  required (or language_code)
//     depth          default 100, max 700; over 100 costs more
//
// Business listings come back in `items` with type `maps_search`. Paid ones
// are `maps_paid_item` and are DROPPED — an ad is not a lead about the
// quality of somebody's website.
//
// COST, so nobody is surprised: $0.002 per live request. A hundred searches
// is twenty cents. The site fetching that follows is free.
//
//
// WHY IT MIRRORS keywordVolumes.js RATHER THAN IMPORTING FROM IT
//
// That module is built around the keyword cache, the budget ledger and a
// keywords_data endpoint with a different task shape. Threading a SERP call
// through it would mean changing a file that charges customers. This is
// forty lines of fetch that shares only the credentials.

'use strict';

const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';

/** Their transport is 200 even when the task failed; 402 is the exception. */
const PAYMENT_REQUIRED = 402;

/** Task-level codes that mean "your account", not "your query". */
const BILLING_TASK_CODES = new Set([40200, 40201, 40202, 20100]);

function credentials() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error(
      'lead scout: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set. ' +
      'They are the same credentials keyword research already uses.'
    );
  }

  return Buffer.from(`${login}:${password}`).toString('base64');
}

/**
 * ONE SEARCH. The caller loops over trades and cities, so retry, pacing and
 * partial-failure policy live there rather than being buried in here.
 *
 * @returns {{businesses: Array, costUsd: number}}
 *   businesses: { title, url, domain, phone, address, rating, votes, placeId }
 */
async function searchMaps({ keyword, location, language = 'English', depth = 100, fetchImpl = fetch }) {
  if (!keyword) throw new Error('lead scout: a keyword is required');
  if (!location) throw new Error('lead scout: a location is required');

  const task = {
    keyword: String(keyword).slice(0, 700),
    location_name: location,
    language_name: language,
    depth,
  };

  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([task]),
  });

  if (res.status === PAYMENT_REQUIRED) {
    throw new Error('lead scout: DataForSEO balance exhausted — top up at app.dataforseo.com');
  }

  if (!res.ok) {
    throw new Error(`lead scout: HTTP ${res.status} from DataForSEO`);
  }

  const body = await res.json();
  const t = (body.tasks || [])[0];

  if (!t) throw new Error('lead scout: DataForSEO returned no task');

  if (BILLING_TASK_CODES.has(t.status_code)) {
    throw new Error(
      `lead scout: DataForSEO rejected the task on account grounds ` +
      `(${t.status_code} ${t.status_message}) — check the balance`
    );
  }

  if (t.status_code !== 20000) {
    throw new Error(`lead scout: DataForSEO task ${t.status_code}: ${t.status_message}`);
  }

  const items = ((t.result || [])[0] || {}).items || [];

  return {
    businesses: items.filter(i => i.type === 'maps_search').map(normalise),
    costUsd: Number(t.cost) || 0,
  };
}

/**
 * Their shape -> ours, and nothing else travels.
 *
 * `rating` arrives as an object; flattening it here means the rest of the
 * tool never has to know whether a practice had any reviews at all.
 */
function normalise(item) {
  const rating = item.rating || {};

  return {
    title: item.title || '',
    url: item.url || '',
    domain: item.domain || '',
    phone: item.phone || '',
    address: item.address || '',
    rating: typeof rating.value === 'number' ? rating.value : null,
    votes: typeof rating.votes_count === 'number' ? rating.votes_count : null,
    placeId: item.place_id || '',
  };
}

module.exports = { searchMaps, normalise, ENDPOINT };
