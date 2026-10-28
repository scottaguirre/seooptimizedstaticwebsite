// utils/blog/cloudflare/accounts.js
//
// Which Cloudflare account a blog belongs to, and how its token is reached.
//
// THE ONE RULE THIS FILE EXISTS FOR
//
//   A BLOG THAT NAMES AN ACCOUNT MUST NEVER FALL BACK TO THE ENVIRONMENT.
//
// Everything in deploy.js and redirects.js falls back when handed no
// credentials, and that is correct for them: every blog that existed before
// 22 October 2026 has no account of its own, and the server's own account is
// the right answer for all of them.
//
// But the fallback is a DEFAULT, not a RECOVERY. If a blog says "I belong to
// account 7" and account 7 cannot be read — deleted, disabled, a token that
// will not decrypt — the honest answer is to stop.
//
// The convenient answer is to fall back, and the convenient answer deploys a
// customer's blog into OUR Cloudflare account: creates the project there,
// attaches their domain to it, reports success. Nothing in the result would
// say otherwise. The first sign would be a customer asking why their blog is
// not on their domain, days later, with a project sitting in the wrong
// account and a DNS record nobody wrote.
//
// So: no account named means undefined, which is the fallback working as
// designed. An account named but unusable throws, every time.

'use strict';

const CloudflareAccount = require('../../../models/CloudflareAccount');
const { open } = require('./secretBox');
const { cfApi, scrub } = require('./deploy');

/**
 * Cloudflare's cap on Pages projects per account.
 *
 * Their documentation states this is not routinely increased, which is why
 * it is a number worth designing around rather than a limit to ask about
 * when it is reached.
 */
const PROJECT_LIMIT = 100;

/** When an account is close enough to full to be worth saying so. */
const NEARLY_FULL_AT = 0.85;

/**
 * The credentials for a blog, or undefined for the server's own account.
 *
 * @param {object} blog  a BlogSite document
 * @returns {Promise<{token:string, account:string}|undefined>}
 */
async function credsFor(blog) {
  const id = blog && blog.cloudflareAccount;

  /* NO ACCOUNT IS NOT AN ERROR. It is every blog that existed before the
   * pool did, and it is how the fallback chain in cfApi() and childEnv()
   * is reached. */
  if (!id) return undefined;

  return credsForAccountId(id);
}

/**
 * The credentials for one account row, by id.
 *
 * SPLIT OUT OF credsFor() ON 25 OCTOBER, when the zone check moved to the
 * admin screen. That screen already holds the CloudflareAccount it is about
 * and has no blog to ask on behalf of — and the alternative was passing
 * `{ cloudflareAccount: id }` as a pretend blog, which reads like a trick
 * and invites somebody to pass a real blog's id into the wrong argument.
 *
 * EVERY REFUSAL IN HERE IS credsFor()'s REFUSAL, unchanged. There is no
 * second copy of the rules: the account missing, disabled, or short of a
 * token or an id all throw with the same words they always did, and
 * `undefined` for "no account named" stays in credsFor() where it belongs,
 * because an ID WAS NAMED is the whole precondition of this function.
 *
 * @param {*} id  a CloudflareAccount _id
 * @returns {Promise<{token:string, account:string}>}
 */
async function credsForAccountId(id) {
  const found = await CloudflareAccount.findById(id);

  /* FROM HERE DOWN, EVERY FAILURE THROWS. The blog has told us where it
   * belongs; being unable to get there is not a reason to go somewhere
   * else. */
  if (!found) {
    throw new Error(
      `This blog is on a Cloudflare account that no longer exists (${id}). `
      + 'It cannot be deployed until the account is restored or the blog is moved.');
  }

  const name = found.label || String(found._id);

  if (false === found.enabled) {
    /* DISABLING STOPS DEPLOYS, DELIBERATELY. The alternative — deploy
     * anyway — would mean the control did nothing for the blogs that
     * already exist, which are the ones somebody disabling an account is
     * usually thinking about. */
    throw new Error(`The Cloudflare account for this blog is disabled (${name}).`);
  }

  if (!found.token) {
    /* Half a row: an account id with no token. cfApi() and childEnv()
     * already refuse half a credential, but they cannot say WHICH account
     * is short of one. */
    throw new Error(`The Cloudflare account "${name}" has no API token stored.`);
  }

  if (!found.accountId) {
    throw new Error(`The Cloudflare account "${name}" has no account id stored.`);
  }

  /* open() THROWS WITH ITS OWN MESSAGE, which already names the two real
   * causes — a rotated CF_TOKEN_KEY, or a row somebody altered — and
   * carries neither the token nor the key. Wrapping it would lose that;
   * catching it would be the fallback this file exists to refuse. */
  return { token: open(found.token), account: found.accountId };
}

/**
 * How much room an account has left, for the admin screen.
 *
 * NEVER NEGATIVE. The count comes from Cloudflare, and an account filled by
 * something other than this app can be at or over the limit. "-3 left" on a
 * screen is worse than "0" — it reads as a bug rather than as a full
 * account, and sends somebody looking in the wrong place.
 *
 * @param {object} account  anything with a `projects` count
 */
function accountCapacity(account) {
  const used = Math.max(0, Number((account && account.projects) || 0));
  const left = Math.max(0, PROJECT_LIMIT - used);

  return {
    limit: PROJECT_LIMIT,
    used,
    left,
    /* SAID BEFORE IT REFUSES, because the refusal lands on a customer
     * pressing Create — not on anybody who could do something about it. */
    nearlyFull: used >= PROJECT_LIMIT * NEARLY_FULL_AT,
  };
}

/**
 * Do this account ID and this token actually work together?
 *
 * WHY THIS EXISTS
 *
 * The form that collects them accepted anything. Edwin opened it, his browser
 * read "text field followed by password field" as a login and autofilled his
 * EMAIL ADDRESS into the account ID and a SAVED PASSWORD into the token — and
 * the handler would have sealed that password, stored it, and said "added".
 *
 * Nothing would have been wrong until a blog was published onto that account
 * weeks later, and what surfaced then would be a raw Cloudflare error naming
 * none of it. That is the same failure shape as the per-field credential
 * fallback caught in cfApi(): the wrong value stored successfully, discovered
 * a long way from where it was entered.
 *
 * So the credentials are used ONCE, here, before anything is written. A
 * credential that cannot read the account it claims to be for is not a
 * credential, and the person who can fix it is standing at the form.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * Proves: the account ID names a real account, the token authenticates, and
 * the token can read Pages ON THAT ACCOUNT. That is every mistake anybody can
 * make at this form — a typo, an email, an autofilled password, yesterday's
 * revoked token, or a token scoped to a DIFFERENT account, which is the
 * dangerous one because it works perfectly against the wrong place.
 *
 * Does NOT prove the token can WRITE. Cloudflare offers Pages as Read or
 * Edit, and a read-only token passes this and fails at the first deploy.
 * Proving Edit means performing one, which is not something an admin form
 * should do to somebody's account. The form says so rather than implying a
 * guarantee it cannot make.
 *
 * @param {{accountId:string, token:string}} creds  as typed, not sealed
 * @param {{api?:Function}} [deps]  cfApi, injected by the tests
 * @returns {Promise<{ok:true, projects:number}|{ok:false, error:string}>}
 */
async function verifyAccount({ accountId, token } = {}, { api = cfApi } = {}) {
  const id = String(accountId == null ? '' : accountId).trim();
  const key = String(token == null ? '' : token).trim();

  if (!id || !key) {
    return { ok: false, error: 'An account ID and an API token are both needed.' };
  }

  /* THE CREDENTIALS ARE PASSED AS A PAIR, which is the whole point: handing
   * cfApi an account with no token, or the reverse, is what makes it fall
   * back to the environment — and a verification that quietly tested the
   * SERVER'S token would pass for every account anybody typed. */
  const answer = await api(
    `/accounts/${encodeURIComponent(id)}/pages/projects`,
    { creds: { account: id, token: key } }
  );

  if (!answer || !answer.ok) {
    /* CLOUDFLARE'S OWN REASON, NOT OURS. "Invalid account identifier",
     * "Invalid API Token" and "Unauthorized" each send somebody somewhere
     * different, and a message of our own would flatten all three into
     * "that did not work". cfApi has already scrubbed the token out of it. */
    return {
      ok: false,
      error: (answer && answer.error) || 'Cloudflare did not answer.',
    };
  }

  /* total_count IS THE COLLECTION; result.length IS ONE PAGE OF IT. Taking
   * the page size would report 25 projects on an account holding 140, which
   * on the admin screen reads as 75 free slots that do not exist. */
  const total = answer.info && Number(answer.info.total_count);

  const projects = Number.isFinite(total) && total >= 0
    ? total
    : (Array.isArray(answer.result) ? answer.result.length : 0);

  return { ok: true, projects };
}

/**
 * Re-count one STORED account's Pages projects.
 *
 * WHY THIS EXISTS
 *
 * `projects` is written once, when the account is added, and was true for
 * exactly as long as nobody created a blog. Edwin's Aguirre Negro account
 * read `0 / 100` with a blog already published on it — the count was taken
 * before the blog existed and nothing ever looked again.
 *
 * A number that is right on day one and silently wrong afterwards is worse
 * than no number: it is read as current, and the `nearlyFull` warning that
 * hangs off it can never fire.
 *
 * WHY IT RETURNS A FAILURE INSTEAD OF THROWING, WHICH credsFor DOES NOT
 *
 * They answer different questions. credsFor is asked "where does THIS BLOG
 * deploy to", and there is one right answer — so an account it cannot read
 * must stop the deploy rather than quietly use another.
 *
 * This is asked "how full is each of these ten accounts", and one unreadable
 * row is not a reason to abandon the other nine. The caller loops, records
 * what it learned, and reports what it could not.
 *
 * @param {object} account  a CloudflareAccount document or lean object
 * @param {{api?:Function}} [deps]
 * @returns {Promise<{ok:true, projects:number}|{ok:false, error:string}>}
 */
async function recountAccount(account, deps = {}) {
  const name = (account && (account.label || String(account._id || ''))) || 'that account';

  if (!account || !account.accountId) {
    return { ok: false, error: `"${name}" has no account id stored.` };
  }

  if (!account.token) {
    return { ok: false, error: `"${name}" has no API token stored.` };
  }

  let token;

  try {
    token = open(account.token);
  } catch (err) {
    /* open() ALREADY NAMES THE TWO REAL CAUSES — a rotated CF_TOKEN_KEY, or
     * a row altered by hand — and carries neither the token nor the key.
     * Prefixed with the label so a loop over ten accounts says WHICH. */
    return { ok: false, error: `"${name}": ${err.message}` };
  }

  const out = await verifyAccount({ accountId: account.accountId, token }, deps);

  if (out.ok) return out;

  /* THE LABEL GOES ON CLOUDFLARE'S REASON TOO. "Invalid API Token" with no
   * account named is a search through ten rows.
   *
   * SCRUBBED ON THE WAY PAST, and the test is why. cfApi scrubs every error
   * it makes, so in production this is a second pass over clean text — but
   * this function is the last thing holding the plaintext token before the
   * message is rendered onto an admin page, one line per account. A page
   * whose safety depends on a function two modules away continuing to
   * behave is a page one refactor from printing a live credential.
   *
   * It is also not hypothetical here: a test stub returning an unscrubbed
   * error walked a token straight through this line. */
  return { ok: false, error: `"${name}": ${scrub(out.error, { token, account: account.accountId })}` };
}

module.exports = {
  credsFor, credsForAccountId, accountCapacity, verifyAccount, recountAccount,
  PROJECT_LIMIT, NEARLY_FULL_AT,
};
