// utils/sectionToggle.js
//
// One reading of an opt-OUT checkbox, for every section that has one.
//
// WHY THIS IS A MODULE AND NOT TWO LINES EACH.
//
// The price-table toggle was written by hand in two files — runGeneration.js
// decides whether to PAY for a section, buildAboutUsPage.js decides whether to
// RENDER it. Run against the same ten inputs they disagreed on exactly one:
// `null`. One read it as off and the other as on, which is a section that is
// generated, charged for, and then not displayed. Nothing throws; the only
// symptom is a missing block on a finished site.
//
// Two hand-written coercions of one value will differ somewhere, and the place
// they differ is never the case anybody thought about. So there is one.
//
// ABSENT MEANS ON, deliberately.
//
// An unchecked checkbox sends nothing at all, so "the customer unticked it"
// and "this caller has never heard of the field" are indistinguishable in a
// request body — and the second covers the WordPress plugin, a cached copy of
// the wizard, and any draft saved before the field existed. Reading a missing
// value as "off" would quietly strip sections from builds nobody asked to
// change. The wizard therefore sends the field on every submit: "true" when
// ticked, "" when not (see injectHiddenSnapshot in generateDinamycForm.js), so
// only a value that is PRESENT and falsy turns a section off.
//
// THIS ONLY EVER SUBTRACTS. Whether a section is permitted at all is
// capabilities(businessType) in businessShape.js — a medical or legal practice
// gets no price table and no trust badges whatever arrives from a form.

/**
 * Was an opt-out checkbox left on?
 *
 * @param {*} value  whatever arrived in the request body for that field
 * @returns {boolean}
 */
function keptOn(value) {
  // `== null` catches undefined AND null. The loose equality is deliberate: a
  // body parser can hand back an explicit null where the wizard sends nothing,
  // and both mean "nobody expressed a preference".
  if (value == null) return true;

  return value === true || value === 'true' || value === 'on' || value === '1';
}

module.exports = { keptOn };
