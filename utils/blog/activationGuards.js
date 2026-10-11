// utils/blog/activationGuards.js
//
// The two questions activation has to ask before it mints a new secret.
//
// WHY THEY LIVE HERE AND NOT IN THE ROUTE
//
// Because one of them did, and it had never once run.
//
//     if (movingFrom && site.lastSeenAt && !body.moveSite) {
//
// `body` was never declared in that handler — the request is `req.body`. So
// the moment the first two conditions were true, that line threw a
// ReferenceError, the handler's catch turned it into
// "Activation failed. Please try again.", and the customer was left with an
// error that says nothing and a tick-box that does nothing.
//
// IT WAS TESTED. test-licence-binding.js asserted `/body\.moveSite/` against
// the source of the route. The phrase was there. Reading a line is not running
// it, and a guard that throws looks exactly like a guard that passes from the
// outside — the request is refused either way.
//
// THAT IS PROBABLY HOW roofingamerica.xyz ENDED UP WITH TWO LICENCE KEYS.
// Edwin tried to reuse a key, got "Activation failed. Please try again.",
// ticked the box, got it again, and created a second key instead. Which is
// the exact situation the second guard below now refuses.
//
// So these are plain functions over plain values. They can be called, not
// grepped, and an undeclared name in one of them is a failing test rather
// than a sentence a customer cannot act on.
//
// BOTH RETURN null FOR "CARRY ON", or the body of a 409. Neither reads the
// database, writes anything, or knows what express is.

/**
 * Is this licence currently living on a different, live site?
 *
 * THE DAMAGE THIS PREVENTS is done one line later in the route: a new secret
 * is minted, and the install holding the old one is dead — every call refused,
 * for ever, with nothing anywhere saying why. On one real site that ran for
 * eight days before anyone noticed.
 *
 * It is correct when a site is genuinely being moved, and a disaster when
 * someone pastes their key into a SECOND site. So it is refused unless the
 * request says plainly that a move is intended. The refusal is not a wall —
 * one tick of a box passes it — but it turns a silent, instant, irreversible
 * act into a deliberate one.
 *
 * ONLY WHEN WE HAVE SEEN THE OTHER SITE. A row whose siteUrl was never filled
 * in, or a licence that has never once called home, has nothing to protect.
 *
 * @param {object} site        the BlogSite the licence key belongs to
 * @param {string} reportedUrl normalised url the plugin says it is on
 * @param {boolean} moveSite   the owner ticked "moving from another site"
 */
function refuseMove({ site, reportedUrl, moveSite }) {
  if (!site || !reportedUrl) return null;
  if (!site.siteUrl || site.siteUrl === reportedUrl) return null;
  if (!site.lastSeenAt) return null;
  if (moveSite) return null;

  return {
    error: `This licence key is already connected to ${site.siteUrl}. `
         + 'Connecting it here will disconnect that site, and its posts will stop publishing. '
         + 'If you are moving the licence, tick "this licence is moving from another site" and save again. '
         + 'If both sites should keep working, create a second key on your account page.',
    reason: 'licence-in-use',
    registeredTo: site.siteUrl,
  };
}

/**
 * Is a DIFFERENT licence already living on this domain?
 *
 * THE QUESTION NOBODY ASKED. refuseMove() looks from the key's side — "where
 * is this key registered?" — and that is only half of it. Nothing looked from
 * the domain's side, so two separate keys could both be activated against one
 * WordPress and neither would notice the other.
 *
 * Found on roofingamerica.xyz, 11 October: two records for one site, one of
 * them still carrying the business of the domain's previous life. The symptom
 * was not an error. It was a roofing blog writing about Austin plumbing, plus
 * a scheduler politely pinging an abandoned record with a secret that no
 * longer matched anything.
 *
 * REVOKED RECORDS DO NOT BLOCK. Revoking is the supported way to retire a
 * licence — it is one click on the Blog Sites page, and it pauses the
 * campaigns rather than destroying them. So the refusal has somewhere to send
 * people, which is the difference between a guard and a dead end.
 *
 * TWO MESSAGES, AND THE QUIETER ONE IS THE IMPORTANT ONE. When the other
 * licence belongs to the same account, the message names the fix, because the
 * owner can carry it out. When it belongs to a DIFFERENT account, it must not:
 * this endpoint is reachable by anyone holding any valid licence key, and a
 * reply that confirmed "yes, that domain is registered here" would make it a
 * way to ask which of our customers owns which site.
 *
 * @param {object} site      the BlogSite the licence key belongs to
 * @param {object} occupant  another non-revoked BlogSite already on this url
 */
function refuseOccupiedDomain({ site, occupant }) {
  if (!occupant || !site) return null;
  if (String(occupant._id) === String(site._id)) return null;

  const sameOwner = String(occupant.user) === String(site.user);

  if (!sameOwner) {
    return {
      error: 'This site is already connected to a different account. '
           + 'If you believe that is wrong, please contact support.',
      reason: 'domain-taken',
    };
  }

  return {
    error: `${occupant.siteUrl} is already connected with a different licence key. `
         + 'Two keys on one site fight over the same posts, and the older one stops working silently. '
         + 'Revoke the other licence on your Blog Sites page, then connect this one again.',
    reason: 'domain-taken',
    registeredTo: occupant.siteUrl,
  };
}

module.exports = { refuseMove, refuseOccupiedDomain };
