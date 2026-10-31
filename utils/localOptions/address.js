// utils/localOptions/address.js
//
// Four typed boxes -> the two strings the rest of the app already uses.
//
// WHY THIS MODE ASKS DIFFERENTLY FROM THE OTHER THREE
// Rank Fast, Rank GBPs and One-Page Design collect ONE free-text "Address"
// box and one "Main Location" box, and that is enough for them: the address
// is printed as typed and handed to the Google Maps embed, which takes any
// string.
//
// Local Website Options cannot. render/chrome.js reads business.street,
// render/schema.js reads business.city, business.state and business.zip
// SEPARATELY, because PostalAddress has a field for each one and a
// LocalBusiness node with the town sitting inside streetAddress is a node
// Google reads wrong rather than not at all.
//
// THE PARTS ARE THE SOURCE, AND THEY ARE THE ONLY SOURCE.
// The alternative was splitting the free-text box on commas, which works
// until somebody types a suite number, omits the ZIP, or writes the state
// out in full — and the failure is silent: addressRegion becomes "Texas
// 78641" or "Suite 4", the page still renders, and nobody finds out until
// the schema is already indexed. So in this mode the four boxes REPLACE the
// Address and Main Location boxes, and `address` and `location` are composed
// here, once, from what the owner typed into them.
//
// Composed rather than dropped because the rest of the pipeline is entitled
// to them: helpers.validateGlobalFields() requires both for every mode,
// utils/googleMap.js takes `address`, and validateAndNormalizeLocationPages()
// compares towns against `location`. Making those four places mode-aware to
// save composing two strings would be the wrong trade.

'use strict';

/* THE SAME SET THE TOWNS LIST IS VALIDATED AGAINST.
 *
 * utils/helpers.js held it privately and now exports it, rather than this
 * file carrying its own copy. There were already two lists of US states in
 * here — that one, and utils/getFullStateName.js's table for writing "TX"
 * out as "Texas" — and a third would have been the one that disagreed with
 * both. The note on the export in helpers.js records where those two part
 * company (DC is in one and not the other). */
const { US } = require('../helpers');

/** The four boxes, in the order they appear on the form. */
const PARTS = ['street', 'city', 'state', 'zip'];

/** What the customer sees beside each one. */
const LABELS = {
  street: 'Street address',
  city: 'City',
  state: 'State',
  zip: 'ZIP code',
};

/** 78641, or 78641-2203. */
const ZIP = /^\d{5}(-\d{4})?$/;

function trim(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * A state code this app accepts.
 *
 * The fifty plus DC. Not the territories — PR, GU, VI and the rest are
 * absent from the set in helpers.js, so they are refused here too, and that
 * is one set to widen rather than a decision this file gets to make on its
 * own.
 */
function knownState(state) {
  return state.length === 2 && US.has(state);
}

/**
 * Read the four address boxes and compose what the pipeline expects.
 *
 * Returns the parts, the two composed strings, and a `fields` array in the
 * shape jsonValidationError() wants — so a missing street highlights the
 * street box rather than reporting "Address Required" about a box that is
 * not on the screen in this mode.
 *
 * @param {object} global  req.body.global
 * @returns {{ ok, fields, street, city, state, zip, address, location }}
 */
function localAddress(global = {}) {
  const street = trim(global.street);
  const city = trim(global.city);
  const state = trim(global.state).toUpperCase();
  const zip = trim(global.zip);

  const fields = [];

  for (const part of PARTS) {
    const value = { street, city, state, zip }[part];
    if (!value) fields.push({ name: `global[${part}]`, message: 'Required' });
  }

  /* SHAPE CHECKED ONLY ON WHAT WAS SUPPLIED. A blank state is already
   * reported as Required just above, and two messages on one box reads as
   * two problems. Same rule helpers.validateGlobalFields() follows for the
   * phone number. */
  if (state && !knownState(state)) {
    fields.push({
      name: 'global[state]',
      message: 'Use the two-letter state code, e.g. TX',
    });
  }

  if (zip && !ZIP.test(zip)) {
    fields.push({
      name: 'global[zip]',
      message: 'Enter a 5-digit ZIP code, e.g. 78641',
    });
  }

  return {
    ok: fields.length === 0,
    fields,
    error: fields.length ? 'Please check the business address.' : '',

    street,
    city,
    state,
    zip,

    /* "1204 Ranch Road 2243, Leander, TX 78641" — one line, as it would be
     * written on an envelope, which is also what the Maps embed resolves
     * best. */
    address: [street, city, `${state} ${zip}`.trim()].filter(Boolean).join(', '),

    /* "Leander, TX" — the form the towns list, the suggestion prompts and
     * validateAndNormalizeLocationPages() all already compare against. */
    location: [city, state].filter(Boolean).join(', '),
  };
}

module.exports = {
  localAddress,
  knownState,
  PARTS,
  LABELS,
  ZIP,
};
