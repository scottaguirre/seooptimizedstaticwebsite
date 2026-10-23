// utils/blog/cloudflare/redirects.js
//
// One address per article, not two.
//
// THE PROBLEM
//
// A Pages project is always reachable at `<project>.pages.dev` as well as at
// the custom domain, and both serve the same bytes. Every article therefore
// exists at two URLs, and Google has to pick one. That is duplicate content
// on a site whose entire purpose is to rank, and it gets worse every week the
// scheduler publishes another post.
//
// WHY NOT _worker.js, WHICH WAS THE FIRST IDEA
//
// Cloudflare's own docs rule it out twice over. Advanced mode "takes effect
// only after you deploy through your Git integration" — this app deploys by
// Direct Upload — and a _worker.js "will assume full control of all incoming
// HTTP requests to your domain", so every static asset must then be served by
// hand through env.ASSETS.fetch. A bug would take down a whole blog rather
// than one page, and it would run on every page view of every blog.
//
// WHY NOT _redirects, WHICH WOULD HAVE BEEN PERFECT
//
// It is just a file in the deploy, so it would have cost nothing. But its
// source is A FILE PATH: matching on hostname is explicitly unsupported. A
// rule written there would fire on the custom domain too and redirect it to
// itself, for ever. Ruled out on the docs, not on a hunch.
//
// SO: BULK REDIRECTS, which is what Cloudflare documents for exactly this.
//
// WHAT THIS FILE OWNS, AND WHAT IT DELIBERATELY DOES NOT
//
// A Bulk Redirect has two halves: a LIST of source -> target pairs, and a
// RULE saying "redirect anything in that list". The rule never changes. It is
// created once, by hand, in the dashboard, and it is not this app's business.
//
// This file only ever adds and removes ITEMS in that list. That keeps the
// token's reach small — the app cannot create or destroy a redirect rule — and
// it means the thing that runs on every blog creation is the simplest
// operation Cloudflare offers.
//
// THE LIST IS FOUND BY NAME, not by an id in the environment. An id is a
// 32-character string nobody can check by eye, and getting it wrong writes a
// blog's redirect into some other list. A name is readable in the dashboard
// and in `.env` at the same time.

'use strict';

const { cfApi, scrub } = require('./deploy');

/* THE PRODUCT'S NAME, IMPORTED RATHER THAN TYPED — and test-brand-name.js
 * caught it typed. These three strings are labels on CLOUDFLARE's side:
 * the list description, the rule description and the ruleset name, sitting
 * in somebody's dashboard saying what put them there.
 *
 * They are still the brand. This app has been renamed twice, and each
 * rename left strings behind in files nobody thought to search — which is
 * the whole reason APP_NAME lives in a module that takes no dependencies,
 * so code that only wants a name only has to take a name. */
const { APP_NAME } = require('../../pageTitle');
const { log } = require('../../logger');

/**
 * The list the dashboard rule points at.
 *
 * UNDERSCORES, NOT HYPHENS, AND THAT IS CLOUDFLARE'S RULE RATHER THAN A
 * PREFERENCE. A list name may only hold lowercase letters, digits and
 * underscores — the default here was `blog-pages-dev` until Edwin tried to
 * create it and the dashboard refused the hyphens. A default nobody can
 * actually use is not a default; it is a step every install has to undo.
 *
 * The name is matched exactly, so the one in the dashboard and the one
 * here have to agree. CF_REDIRECT_LIST overrides it for an account that
 * already calls the list something else.
 */
const LIST_NAME = process.env.CF_REDIRECT_LIST || 'blog_pages_dev';

/** How long to wait for Cloudflare to apply a list change. */
const OPERATION_TIMEOUT_MS = Number(process.env.CF_LIST_TIMEOUT_MS) || 20000;

/** How often to ask whether it has finished. */
const POLL_MS = Number(process.env.CF_LIST_POLL_MS) || 1000;

/* THE ACCOUNT PREFIX, SPELLED THE WAY deploy.js SPELLS IT. cfApi() takes a
 * path and prepends the API base and nothing else — it does not substitute
 * an account id, and the first draft of this file assumed it did. Every
 * call would have gone to a literal "${account(creds)}/..." and come back
 * as a Cloudflare error about a malformed account. */
/* TAKES THE CREDENTIALS IN PLAY — 22 October, when blogs moved onto a pool
 * of Cloudflare accounts.
 *
 * A RULES LIST LIVES INSIDE AN ACCOUNT, and that is the part of this change
 * with a consequence outside the code: there is no shared blog_pages_dev
 * spanning the pool. Every account in it needs its own list, with that
 * name, created by hand.
 *
 * That is survivable rather than a launch blocker because findRedirectList
 * reports a miss instead of throwing: a blog whose account has no list
 * still deploys and still works, it just also answers on pages.dev. The
 * accounts can be set up one at a time. */
const account = (creds) =>
  `/accounts/${encodeURIComponent((creds && creds.account) || process.env.CF_ACCOUNT_ID || '')}`;

/**
 * The account's redirect list, by name.
 *
 * A MISS IS NOT AN ERROR THE DEPLOY SHOULD DIE ON. Edwin creates the list
 * and the rule by hand; until he has, every blog still deploys and still
 * works — it just also answers on pages.dev, which is where we started. The
 * caller logs it and carries on.
 */
async function findRedirectList({ name = LIST_NAME, fetchImpl = fetch, creds } = {}) {
  const found = await cfApi(`${account(creds)}/rules/lists`, { fetchImpl, creds });

  if (!found.ok) return { ok: false, error: found.error };

  /* KIND CHECKED, NOT JUST THE NAME. An account can hold IP lists and ASN
   * lists beside redirect lists, and a name collision across kinds would
   * put a redirect into a list that cannot hold one — an error at write
   * time, about a list, a long way from here. */
  const list = (found.result || []).find(
    l => l && String(l.name) === String(name) && 'redirect' === l.kind
  );

  if (!list) {
    /* `noList` SEPARATES "THERE IS NO LIST" FROM "I COULD NOT ASK".
     *
     * ensureRedirectList() creates one through this branch, and must not
     * create one because a token was revoked or Cloudflare was down — that
     * would be a POST fired at an account we cannot read, on the strength
     * of a question that was never answered.
     *
     * Same shape as findZone's `noZone`, for the same reason: a failure to
     * ask is not an answer. */
    return {
      ok: false,
      noList: true,
      error: `No redirect list called "${name}".`,
    };
  }

  return { ok: true, id: list.id, name: list.name };
}

/**
 * Wait for an asynchronous list change to land.
 *
 * ADDING AN ITEM IS NOT SYNCHRONOUS. The POST returns an operation id and a
 * 200, and the redirect is not live yet. Returning at that point would make
 * the deploy report success for something that had not happened, which is
 * the shape of bug that cost an evening over `domainAttached: true` and a
 * DNS record that did not exist.
 *
 * A TIMEOUT IS NOT A FAILURE OF THE DEPLOY. The operation is still running
 * at Cloudflare and will almost certainly finish; we simply stop watching.
 * Said plainly rather than reported as an error.
 */
async function waitForOperation({ id, fetchImpl = fetch, now = Date.now, sleep, creds } = {}) {
  if (!id) return { ok: true, note: 'Cloudflare reported no operation to wait for.' };

  const pause = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const started = now();

  for (;;) {
    const status = await cfApi(
      `${account(creds)}/rules/lists/bulk_operations/${encodeURIComponent(id)}`,
      { fetchImpl, creds }
    );

    if (!status.ok) return { ok: false, error: status.error };

    const state = String((status.result || {}).status || '');

    if ('completed' === state) return { ok: true, completed: true };

    if ('failed' === state) {
      return { ok: false, error: scrub(String((status.result || {}).error || 'The list change failed.')) };
    }

    if (now() - started >= OPERATION_TIMEOUT_MS) {
      return { ok: true, completed: false, note: 'Cloudflare is still applying the change.' };
    }

    await pause(POLL_MS);
  }
}

/** Every item in the list, so an entry can be found or checked. */
async function listItems({ listId, fetchImpl = fetch, creds } = {}) {
  const got = await cfApi(
    `${account(creds)}/rules/lists/${encodeURIComponent(listId)}/items`,
    { fetchImpl, creds }
  );

  if (!got.ok) return { ok: false, error: got.error };

  return { ok: true, items: got.result || [] };
}

/**
 * Point a project's pages.dev address at the blog's real domain.
 *
 * THE PARAMETERS ARE NOT DEFAULTS, AND TWO OF THEM MATTER ENORMOUSLY:
 *
 *   subpath_matching      defaults to FALSE. Left alone, only the home page
 *                         redirects and every article goes on serving twice
 *                         — which is the whole problem, unsolved, while the
 *                         screen says it is fixed.
 *   preserve_query_string defaults to FALSE, so every ?utm_source= would be
 *                         thrown away on the way through.
 *   preserve_path_suffix  defaults to true but ONLY applies when subpath
 *                         matching is on. Set explicitly so the pair reads
 *                         as the single decision it is.
 *   include_subdomains    catches the deployment-hash addresses as well —
 *                         a1b2c3.project.pages.dev serves the same bytes.
 *   status_code           301. A permanent move is the point: a 302 tells
 *                         Google to keep indexing the pages.dev copy.
 */
async function addRedirect({ listId, source, target, fetchImpl = fetch, wait = waitForOperation, creds } = {}) {
  if (!listId || !source || !target) return { ok: false, error: 'Nothing to redirect.' };

  const added = await cfApi(
    `${account(creds)}/rules/lists/${encodeURIComponent(listId)}/items`,
    {
      method: 'POST',
      fetchImpl,
      creds,
      body: [{
        redirect: {
          source_url: String(source),
          target_url: String(target),
          status_code: 301,
          subpath_matching: true,
          preserve_path_suffix: true,
          preserve_query_string: true,
          include_subdomains: true,
        },
      }],
    }
  );

  if (!added.ok) return { ok: false, error: added.error };

  const settled = await wait({ id: (added.result || {}).operation_id, fetchImpl, creds });

  if (!settled.ok) return { ok: false, error: settled.error };

  return { ok: true, added: true, completed: !!settled.completed, note: settled.note };
}

/**
 * Take a blog's redirect back out when the blog is deleted.
 *
 * TWO LOCKS, BOTH MUST OPEN — the same rule removeDnsRecord() follows, and
 * for the same reason. An entry is only this blog's if its SOURCE is this
 * project's pages.dev address AND its TARGET is this blog's domain. Matching
 * on the source alone would be enough in every case anybody has thought of,
 * and the one nobody thought of is the one that deletes a live site's
 * redirect. An entry that fails either test is reported and left alone.
 */
async function removeRedirect({ listId, source, expected, fetchImpl = fetch, wait = waitForOperation, creds } = {}) {
  if (!listId || !source) return { ok: false, error: 'Nothing to remove.' };

  const got = await listItems({ listId, fetchImpl, creds });
  if (!got.ok) return { ok: false, error: got.error };

  /* COMPARED AFTER NORMALISING, NOT AS TYPED — 19 October, found in
   * production rather than in a test.
   *
   * Deleting all-about-concrete logged `ok: true, removed: false`: the list
   * was read, nothing matched, and the teardown reported success while
   * leaving an orphan entry pointing at a domain with no blog behind it.
   * The entry was there. It simply was not spelled the way this code spells
   * it — Cloudflare's own docs give source_url both ways, `example.com/blog/`
   * in one example and `https://example.com/blog` in another, and an entry
   * added by hand in the dashboard carries whatever was typed.
   *
   * So neither form is "correct" and matching on the exact string was never
   * going to hold. Scheme and trailing slash are dropped from both sides
   * before comparing, which is the only comparison that means what this
   * code is actually asking: is this the same address. */
  const bare = (url) => String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  const wanted = bare(source);

  const item = got.items.find(
    i => i && i.redirect && bare(i.redirect.source_url) === wanted
  );

  if (!item) return { ok: true, removed: false, note: 'There was no redirect to remove.' };

  const points = String((item.redirect || {}).target_url || '');

  if (expected && points.replace(/\/$/, '') !== String(expected).replace(/\/$/, '')) {
    return {
      ok: false,
      error: `${source} redirects to ${points}, which is not this blog's. It was left alone.`,
    };
  }

  const gone = await cfApi(
    `${account(creds)}/rules/lists/${encodeURIComponent(listId)}/items`,
    { method: 'DELETE', fetchImpl, creds, body: { items: [{ id: item.id }] } }
  );

  if (!gone.ok) return { ok: false, error: gone.error };

  const settled = await wait({ id: (gone.result || {}).operation_id, fetchImpl, creds });

  if (!settled.ok) return { ok: false, error: settled.error };

  return { ok: true, removed: true, completed: !!settled.completed };
}

/** The ruleset phase a Bulk Redirect rule lives in. */
const REDIRECT_PHASE = 'http_request_redirect';

/**
 * The account's redirect list, created if it is not there.
 *
 * WHY THE APP MAKES IT RATHER THAN EDWIN — 23 October.
 *
 * Every Cloudflare account in the pool needs its own list; they are
 * account-scoped and cannot be shared. That meant ten accounts, ten trips
 * to the dashboard, and one chance each to forget — and forgetting is
 * SILENT, because a blog with no redirect still deploys and still works.
 * It just also answers on pages.dev, which is the duplicate the list
 * exists to remove.
 *
 * CREATED ONLY ON A GENUINE MISS. `noList` is what says the account has no
 * such list; any other failure means the question was not answered, and
 * POSTing on the strength of that creates a list inside an account we
 * could not read.
 */
async function ensureRedirectList({ name = LIST_NAME, fetchImpl = fetch, creds } = {}) {
  const found = await findRedirectList({ name, fetchImpl, creds });

  /* ONE GUARD, NOT TWO, AND MUTATION IS WHY.
   *
   * This had `if (found.ok) return found;` above it — the happy path,
   * spelled out. Deleting that changed nothing any test could see, because
   * `!found.noList` is already true for a list that WAS found. A line that
   * cannot be observed is a line somebody will one day "fix" in the wrong
   * direction.
   *
   * What matters: ANYTHING BUT A GENUINE MISS COMES STRAIGHT BACK — the
   * list we found, or the failure that stopped us finding out. Only
   * `noList` falls through to create one. */
  if (!found.noList) return found;

  const made = await cfApi(`${account(creds)}/rules/lists`, {
    method: 'POST',
    fetchImpl,
    creds,
    body: {
      name,
      kind: 'redirect',
      description: `${APP_NAME}: each blog's pages.dev address sent to its own domain.`,
    },
  });

  if (!made.ok) return { ok: false, error: made.error };

  const id = (made.result || {}).id;

  /* A 200 WITH NO ID IS NOT A LIST. Returning ok here would send the
   * caller on to POST items at `/rules/lists/undefined/items`. */
  if (!id) return { ok: false, error: 'Cloudflare created the list but did not say its id.' };

  return { ok: true, id, name, created: true };
}

/**
 * The Bulk Redirect rule that switches the list on.
 *
 * A LIST ON ITS OWN DOES NOTHING, and that is what catches people out —
 * Edwin built a list, saw it marked Active, and nothing redirected. The
 * rule is what applies it.
 *
 * ADDS ONE RULE, NEVER REPLACES THE SET. Cloudflare's PUT on a ruleset
 * replaces every rule in it, so sending back a list built from what we
 * happened to read would delete any other redirect rule on that account
 * the moment that read was incomplete. POST /rules adds one and leaves the
 * rest alone — on an account that may be a client's, that distinction is
 * the whole difference between a feature and an incident.
 *
 * ONLY CALLED WHEN THE LIST WAS JUST CREATED. A list made by hand with no
 * rule is not healed by this; it is the state Edwin had, and now that the
 * app makes both together it is not a state anything new can reach.
 */
async function ensureRedirectRule({ name = LIST_NAME, fetchImpl = fetch, creds } = {}) {
  const rule = {
    /* A STABLE ref, so a later run recognises its own rule instead of
     * adding a second one beside it. */
    ref: `three_comets_${name}`,
    expression: `http.request.full_uri in $${name}`,
    description: `${APP_NAME}: pages.dev to the blog's own domain`,
    action: 'redirect',
    action_parameters: {
      from_list: { name, key: 'http.request.full_uri' },
    },
  };

  const entry = await cfApi(
    `${account(creds)}/rulesets/phases/${REDIRECT_PHASE}/entrypoint`,
    { fetchImpl, creds }
  );

  /* NO ENTRYPOINT YET is the ordinary case on a fresh account: the phase
   * has no ruleset until something puts a rule in it. */
  if (!entry.ok) {
    const made = await cfApi(`${account(creds)}/rulesets`, {
      method: 'POST',
      fetchImpl,
      creds,
      body: {
        name: `${APP_NAME} blog redirects`,
        kind: 'root',
        phase: REDIRECT_PHASE,
        rules: [rule],
      },
    });

    return made.ok ? { ok: true, created: true } : { ok: false, error: made.error };
  }

  const current = (entry.result && entry.result.rules) || [];

  const already = current.some(r =>
    r && r.action_parameters && r.action_parameters.from_list
    && r.action_parameters.from_list.name === name);

  if (already) return { ok: true, already: true };

  const id = (entry.result || {}).id;
  if (!id) return { ok: false, error: 'Cloudflare did not say which ruleset to add the rule to.' };

  const put = await cfApi(`${account(creds)}/rulesets/${encodeURIComponent(id)}/rules`, {
    method: 'POST', fetchImpl, creds, body: rule,
  });

  return put.ok ? { ok: true, added: true } : { ok: false, error: put.error };
}

/**
 * The whole job for one blog, in the shape the deploy wants.
 *
 * NEVER THROWS AND NEVER FAILS THE DEPLOY. A blog with no redirect is a
 * working blog with a duplicate-content problem; a deploy that died trying
 * to tidy that up is a blog that is not on the internet. The result is
 * reported so the screen can say what happened, and that is all.
 */
async function redirectPagesDev({ project, domain, requestId, fetchImpl = fetch, creds } = {}) {
  const source = `${String(project || '')}.pages.dev`;
  const target = `https://${String(domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const list = await ensureRedirectList({ fetchImpl, creds });
  if (!list.ok) return { ok: false, error: list.error };

  /* THE RULE GOES IN BESIDE A LIST WE JUST MADE, because a list with no
   * rule does nothing — and an account set up entirely by this function
   * would otherwise be set up wrong, silently, in exactly the way this
   * change exists to stop. */
  if (list.created) {
    const rule = await ensureRedirectRule({ fetchImpl, creds });

    if (!rule.ok) {
      return {
        ok: false,
        error: 'The redirect list was created but the rule was not, so nothing '
          + `redirects yet: ${rule.error}`,
      };
    }
  }

  const added = await addRedirect({ listId: list.id, source, target, fetchImpl, creds });

  log.info('blog.redirect.pagesDev', {
    requestId,
    source,
    target,
    ok: added.ok,
    completed: added.completed,
    error: added.error,
  });

  return added;
}

/** The mirror, for teardown. Same contract: reports, never throws. */
async function releasePagesDev({ project, domain, requestId, fetchImpl = fetch, creds } = {}) {
  const source = `${String(project || '')}.pages.dev`;
  const expected = `https://${String(domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const list = await findRedirectList({ fetchImpl, creds });
  if (!list.ok) return { ok: false, error: list.error };

  const removed = await removeRedirect({ listId: list.id, source, expected, fetchImpl, creds });

  log.info('blog.redirect.released', {
    requestId,
    source,
    ok: removed.ok,
    removed: removed.removed,
    error: removed.error,
  });

  return removed;
}

module.exports = {
  ensureRedirectList, ensureRedirectRule, REDIRECT_PHASE,
  findRedirectList, addRedirect, removeRedirect, listItems, waitForOperation,
  redirectPagesDev, releasePagesDev,
  LIST_NAME,
};
