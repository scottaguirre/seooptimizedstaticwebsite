// utils/fullAddress.js
//
// The postal address as a reader expects to see it, for the hero NAP bar.
//
// WHY THIS EXISTS. The Design 7 hero prints an "Address:" row, and it was
// printing whatever went into the wizard's one free-text Address box:
//
//     Address:  1800 Sequoia Dr
//
// which is a street, not an address. Nothing was broken — the box said
// "Address", the owner typed a street, and the page printed it back.
//
// THREE MODES ASK FOR ONE BOX, ONE MODE ASKS FOR FOUR. Local Website Options
// collects street / city / state / ZIP separately and utils/localOptions/
// address.js already composes them into "1800 Sequoia Dr, Leander, TX 78641".
// Rank Fast, Rank GBPs and One-Page collect a single box, and whatever is in
// it is all there is. So this cannot read a city or a ZIP from anywhere: it
// can only use `location`, which those modes DO collect, and which is
// "Leander, TX".
//
//     A ZIP CODE APPEARS HERE ONLY IF SOMEBODY TYPED ONE. There is no field
//     holding it in three of the four modes, and inventing one for a page
//     that tells customers where to drive is not a thing this file will do.
//
// WHY NOT JUST CONCATENATE. Because the address is often already complete —
// always in Local Website Options, and whenever an owner typed the whole
// thing into the free-text box. "1800 Sequoia Dr, Leander, TX 78641,
// Leander, TX" is worse than the street alone. So the parts are added only
// when they are missing, checked one at a time rather than all-or-nothing:
// an address that names the town but not the state gets the state.

'use strict';

/**
 * Lowercase, strip punctuation, collapse whitespace — for COMPARING only.
 * The returned address is always the owner's own text, never this.
 */
function normalize(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compose the address shown in the hero.
 *
 * @param {string} address   the Address box, as typed
 * @param {string} location  "Leander, TX" — city and state
 * @returns {string}         the address with city and state added if absent
 *
 * Either argument may be empty; whichever is present is returned on its own.
 */
function fullAddress(address, location) {
  const street = String(address == null ? '' : address).trim();
  const where = String(location == null ? '' : location).trim();

  if (!street) return where;
  if (!where) return street;

  // "Leander, TX" -> city "Leander", state "TX". A location with no comma is
  // a town on its own, which is fine: state is then empty and skipped.
  const [cityRaw = '', stateRaw = ''] = where.split(',');
  const city = cityRaw.trim();
  const state = stateRaw.trim();

  const flat = normalize(street);

  // SPACE-PADDED so "Leander" is not found inside "Leanderville", and so a
  // street called "Austin Avenue" in Austin still counts as naming the town.
  // That second case is a false positive this accepts: appending ", Austin,
  // TX" to "123 Austin Avenue" would read worse than leaving it.
  const hasCity = city ? ` ${flat} `.includes(` ${normalize(city)} `) : true;

  // Word boundaries, because a two-letter state code is a substring of
  // plenty of ordinary words — "TX" sits inside nothing common, but "IN",
  // "OR", "OK" and "ME" are words, and `\b` is what keeps "123 Main St" in
  // Maine from looking like it already says ME.
  const hasState = state
    ? new RegExp(`\\b${state.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(street)
    : true;

  if (hasCity && hasState) return street;
  if (hasCity && state) return `${street}, ${state}`;

  return `${street}, ${where}`;
}

module.exports = { fullAddress, normalize };
