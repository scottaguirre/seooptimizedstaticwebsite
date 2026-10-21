// utils/blog/cloudflare/deploy.js
//
// Pushing a rendered blog to Cloudflare Pages.
//
// WHY WRANGLER AND NOT THE REST API
//
// Checked on 17 October, and the answer was not the one the plan assumed.
// **Cloudflare publishes no documented REST API for Pages Direct Upload.**
// Their docs cover listing deployments, not uploading files. The upload
// sequence people use — upload token, check-missing, assets/upload,
// upsert-hashes, then a multipart deployment POST — is reverse-engineered
// from Wrangler's source, and carries no stability guarantee.
//
// One detail settles it. The asset key is
//
//     blake3( base64(contents) + extension ).hex()[:32]
//
// and **Node has no BLAKE3**: `crypto` offers blake2b and blake2s, not
// blake3. We would be adding a third-party hash implementation in order to
// reimplement an undocumented protocol — and when the hash is wrong the API
// ACCEPTS the upload and the pages 404 afterwards. A silent failure on a
// customer's domain is the worst outcome available here.
//
// `wrangler pages deploy` IS Direct Upload. Same mechanism, same exemption
// from the 500-builds-a-month quota that the whole design rests on,
// maintained by the people who change the protocol.
//
// WHAT THIS FILE IS CAREFUL ABOUT
//
// Two things, and neither is Cloudflare's fault:
//
//   THE TOKEN. It is passed to the child process and must never reach a
//   log line, an error message, or a thrown stack. wrangler's own output is
//   captured and surfaced on failure, so the capture is filtered too.
//
//   THE PATHS. File paths come from article slugs, which come from model
//   output. A slug of `../../etc/whatever` writing outside the temp
//   directory would be this file's fault, not the model's.
//
// NOTHING HERE RENDERS ANYTHING. It takes a map of path to contents and
// puts it on the internet. What goes in the map is postPage.js, feeds.js
// and blogJson.js's business.

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { log } = require('../../logger');

/* How long one deploy may take before it is abandoned. A 52-post blog is a
 * few hundred kilobytes, so this is generous — it exists so a hung child
 * cannot hold a job slot for ever, not to bound normal work. */
const DEPLOY_TIMEOUT_MS = Number(process.env.CF_DEPLOY_TIMEOUT_MS) || 300000;

/**
 * A Cloudflare Pages project name built from a blog's domain.
 *
 * Cloudflare accepts lower-case letters, digits and hyphens, starting and
 * ending alphanumeric. A domain is nearly that already — the dots have to
 * go, and `blog.example.com` and `blog-example-com` must not collide, which
 * they cannot once every separator is a hyphen and the whole string is the
 * domain.
 *
 * DERIVED, NOT STORED — at first. The name is written to BlogSite.project
 * the first time a blog deploys, and read from there afterwards, because a
 * blog whose domain changes must keep its project rather than silently
 * start a second one and leave the first serving stale pages.
 */
function projectNameFor(blog) {
  const domain = String((blog && blog.siteUrl) || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  const name = domain
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58)
    .replace(/-+$/, '');

  if (!name || !/^[a-z0-9]/.test(name)) {
    throw new Error('Cannot build a Cloudflare project name from this blog\'s domain');
  }

  return name;
}

/**
 * Where a file is allowed to be written.
 *
 * REJECTS RATHER THAN SANITISES. A path that tried to leave the directory
 * is not a path with a typo in it — something upstream produced a slug it
 * should not have, and quietly rewriting it would deploy a page at an
 * address nobody chose. The deploy stops and says which path.
 */
function resolveInside(root, relative) {
  const clean = String(relative || '').replace(/^\/+/, '');
  const full = path.resolve(root, clean);

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!full.startsWith(rootWithSep)) {
    throw new Error(`Refusing to write outside the deploy directory: ${relative}`);
  }

  return full;
}

/**
 * Write the rendered site to a directory.
 *
 * @param {string} root
 * @param {object} files  path -> string | Buffer
 */
async function writeSite(root, files) {
  for (const [relative, contents] of Object.entries(files || {})) {
    const full = resolveInside(root, relative);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, contents);
  }
}

/**
 * Everything the child is allowed to see.
 *
 * NOT `...process.env` PLUS THE TOKEN. The child gets what it needs and
 * nothing else — this app's environment holds the Mongo URI, the OpenAI
 * key, the Stripe secret and the session secret, and none of them are
 * wrangler's business. PATH and HOME are there because node and npx need
 * them to run at all.
 *
 * THE NAMES CHANGE HERE. Our .env calls them CF_*, following the plan;
 * wrangler reads CLOUDFLARE_*. Mapping in one place beats a second set of
 * variables that can drift out of step with the first.
 */
function childEnv() {
  const token = process.env.CF_API_TOKEN;
  const account = process.env.CF_ACCOUNT_ID;

  if (!token || !account) {
    throw new Error('CF_API_TOKEN and CF_ACCOUNT_ID are not set on this server');
  }

  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: account,
    // Wrangler phones home and prints a banner otherwise. Neither is useful
    // from inside a job, and the banner makes the output harder to read
    // when something has gone wrong.
    WRANGLER_SEND_METRICS: 'false',
    CI: 'true',
  };
}

/**
 * Remove anything secret from text that might be logged or thrown.
 *
 * BELT AND BRACES. wrangler does not print the token, and this is here for
 * the version that one day does — in an error, in a debug line, in a
 * stack. By then nobody will be reading this file.
 */
function scrub(text) {
  let out = String(text == null ? '' : text);

  for (const secret of [process.env.CF_API_TOKEN, process.env.CF_ACCOUNT_ID]) {
    if (secret && secret.length > 6) out = out.split(secret).join('[redacted]');
  }

  return out;
}

/** The deployment URL wrangler prints, if it printed one. */
function urlFrom(output) {
  const match = String(output || '').match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i);
  return match ? match[0] : null;
}

/**
 * Where the installed wrangler is, or null if there is not one.
 *
 * THROUGH package.json, NOT STRAIGHT AT THE FILE, and this is not
 * defensive style — the obvious spelling does not work:
 *
 *     require.resolve('wrangler/bin/wrangler.js')
 *     -> ERR_PACKAGE_PATH_NOT_EXPORTED
 *
 * wrangler declares an `exports` map, and a package with one is reachable
 * ONLY at the subpaths it lists. `./bin/wrangler.js` is not among them,
 * even though the file is right there and `bin` in the same package.json
 * points at it. Node refuses the path rather than the file.
 *
 * SHIPPED BROKEN FOR ONE DEPLOY, which is how this comment exists. The
 * container these tests run in had no wrangler at all, so the lookup
 * returned null and the "not installed" branch looked correct. It was
 * returning null on a machine where wrangler WAS installed.
 *
 * `./package.json` is exported by convention and by wrangler, so the
 * package directory is reachable; `bin.wrangler` inside it names the entry
 * the same way npm does when it builds the .bin shim. Verified against a
 * real install: the path exists and `node <entry> --version` prints the
 * version.
 *
 * SEPARATE FROM runWrangler() SO IT CAN BE TESTED. The runner spawns a
 * process, which no test should do — but which file it would have spawned
 * is exactly the thing worth checking, and that is a lookup. `moduleName`
 * is a parameter for the same reason.
 */
function wranglerEntry(moduleName = 'wrangler') {
  try {
    const pkgPath = require.resolve(`${moduleName}/package.json`);
    const bin = require(pkgPath).bin;

    const relative = 'string' === typeof bin ? bin : (bin && bin[moduleName]);
    if (!relative) return null;

    /* NO existsSync HERE. A package.json whose `bin` names a file that is
     * not there is a broken install, and spawning it fails with ENOENT
     * saying exactly which path — which is as clear as anything this could
     * add. The check was in an earlier version and could not be killed by
     * any test that did not first fabricate a broken package, so it was a
     * line nothing protected. */
    return path.join(path.dirname(pkgPath), relative);

  } catch (err) {
    return null;
  }
}

/**
 * Run wrangler, capturing its output.
 *
 * INJECTABLE, so the tests never spawn anything. A test that shelled out
 * to a real wrangler would need a Cloudflare account to run, which means
 * it would not run.
 */
function runWrangler(args, { env, cwd, timeout = DEPLOY_TIMEOUT_MS, entry } = {}) {
  return new Promise((resolve) => {
    /* THE INSTALLED COPY, RESOLVED, RATHER THAN `npx wrangler`.
     *
     * `npx --yes wrangler` looks tidier and is wrong inside a job: when the
     * dependency is missing it DOWNLOADS it, so a server that failed its
     * npm install deploys a blog anyway — slowly, over the network, with
     * whatever version is current that day. wrangler is a declared
     * dependency precisely so the version is decided at install time.
     *
     * Run through node rather than the .bin shim: the shim is a symlink
     * that depends on how npm laid out the tree, and this does not.
     *
     * A missing module throws here, with the module's own name in the
     * message, which is the right failure — loud, at the first deploy,
     * naming what to install. */
    /* THE LOOKUP IS A PARAMETER so a test can force this branch without
     * wrangler actually being missing.
     *
     * THIS COST A FAILED DEPLOY. The test for it used to call runWrangler()
     * and rely on wrangler being ABSENT — which it was in the container the
     * suite was written in. On a machine where wrangler is installed, the
     * same test spawned the real binary with an empty environment and
     * failed. A suite that only passes where the dependency is missing is
     * one that breaks the moment the dependency arrives.
     *
     * `undefined` means "look it up"; `null` means "there isn't one". */
    const resolved = undefined === entry ? wranglerEntry() : entry;

    if (!resolved) {
      resolve({
        code: -1,
        stdout: '',
        stderr: 'wrangler is not installed on this server — run npm install',
      });
      return;
    }

    const child = spawn(process.execPath, [resolved, ...args], { env, cwd });

    let stdout = '';
    let stderr = '';
    let timer = null;

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr += `\nwrangler was killed after ${timeout}ms`;
    }, timeout);

    child.on('error', err => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` });
    });

    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Make sure the Pages project exists.
 *
 * WHY THIS IS A SEPARATE CALL AND NOT A FLAG ON THE DEPLOY.
 *
 * `wrangler pages deploy --project-name=X` does NOT create X. Cloudflare's
 * own error says so and names the command to run instead. Edwin's first
 * real deploy failed on exactly this, and he created the project by hand
 * over ssh to get unblocked — which is not a step a customer will ever do.
 *
 * `--production-branch=main` BECAUSE THE DEPLOY USES `--branch=main`. A
 * project created with a different production branch treats every one of
 * our deploys as a PREVIEW: each lands on its own hashed address and the
 * project's own `<name>.pages.dev` serves nothing at all. The site would
 * be live, reachable, and at an address that changes every time.
 *
 * ALREADY EXISTS IS NOT A FAILURE, and this does not try to tell the two
 * apart. Cloudflare's codes for "name taken" and "name taken BY YOU" are
 * not worth a lookup table that has to stay correct: the deploy that runs
 * next is the authority. It either works, in which case the project was
 * fine however it got there, or it fails and says why. What this returns
 * is the OUTPUT, so a genuine create failure can be shown alongside the
 * deploy failure it caused rather than vanishing.
 */
async function ensureProject({ project, env, run = runWrangler, entry }) {
  const result = await run(
    ['pages', 'project', 'create', project, '--production-branch=main'],
    { env, entry }
  );

  return {
    created: 0 === result.code,
    output: scrub(`${result.stdout}\n${result.stderr}`),
  };
}

/**
 * Take the Pages project away.
 *
 * WHY DELETING THE BLOG IS NOT ENOUGH ON ITS OWN. A Pages project owns a
 * subdomain that is unique across the whole of Cloudflare, and the name
 * stays taken while the project exists. Delete the blog here, add it again
 * with the same domain, and the new project cannot have the old name —
 * Cloudflare hands it a suffixed one instead. That is exactly where
 * `appliancerepaircedarpark-com-bx6` came from.
 *
 * SO IT IS OFFERED, NOT ASSUMED. A project may have a custom domain
 * pointing at it, analytics against it, or simply be something the owner
 * wants to keep while clearing our side. The screen asks; this does as it
 * is told.
 *
 * `--yes` BECAUSE THERE IS NOBODY AT THE TERMINAL. Without it wrangler
 * waits for a confirmation that will never come, and the job sits there
 * until the timeout kills it. The confirmation happened on a web page.
 */
async function deleteProject({ project, env, run = runWrangler } = {}) {
  if (!project) return { ok: false, output: 'No project name.' };

  const result = await run(['pages', 'project', 'delete', project, '--yes'], { env });

  return { ok: 0 === result.code, output: scrub(`${result.stdout}\n${result.stderr}`) };
}

/**
 * One Cloudflare REST call, with the three failure shapes folded into one.
 *
 * WHY A HELPER FOR WHAT LOOKS LIKE A ONE-LINER. Cloudflare's API fails in
 * three ways that have nothing in common:
 *
 *   the request never lands        fetch throws
 *   the request is refused         an HTTP status outside 2xx
 *   the request is "accepted"      200, with success: false and an errors
 *                                  array saying why
 *
 * The third is the one that bites: read response.ok alone and a refusal
 * sails through as a success. Four call sites each remembering that is
 * four chances to forget it, so they do not get the choice.
 *
 * THE ERRORS ARRAY IS WHAT COMES BACK, NOT A SENTENCE OF OURS. "Zone not
 * found", "token lacks a permission" and "already exists" are three
 * different things to do next, and flattening them into one message is
 * exactly how an afternoon goes missing — see CF_ACCOUNT_ID, 17 October.
 */
async function cfApi(pathAndQuery, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;

  if (!account || !token) return { ok: false, error: 'No Cloudflare credentials.' };

  try {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${pathAndQuery}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      /* The same rule blogScheduler.js follows: never hand a bearer token
       * to whatever a redirect points at. */
      redirect: 'manual',
    });

    const answer = await response.json().catch(() => ({}));

    if (!response.ok || false === answer.success) {
      const said = (answer.errors || [])
        .map(e => `${e.message}${e.code ? ` [code: ${e.code}]` : ''}`)
        .join('; ');

      return { ok: false, error: scrub(said || `Cloudflare answered ${response.status}.`) };
    }

    return { ok: true, result: answer.result };

  } catch (err) {
    return { ok: false, error: scrub(err.message || 'The request to Cloudflare failed.') };
  }
}

/**
 * Which of this account's zones owns a hostname.
 *
 * WALKED LABEL BY LABEL, LONGEST FIRST. The zone for
 * `all-about-plumbing.explr-home.com` is `explr-home.com`, and there is no
 * way to know that from the string: `co.uk` is not a zone and
 * `blog.example.com` sometimes is one. So each suffix is offered to
 * Cloudflare in turn and the first it recognises wins — the most specific
 * match, which is the right one when somebody has delegated a subdomain
 * as a zone of its own.
 *
 * STOPS AT TWO LABELS. Below that the only candidates are public suffixes
 * — `co.uk`, `com` — which no account owns and which would be a query per
 * deploy for a guaranteed miss.
 *
 * A MISS IS NOT AN ERROR. The domain may belong to a different Cloudflare
 * account, or to a registrar that is not Cloudflare at all. That is a
 * normal way to run a blog; it just means the DNS record is somebody
 * else's job, and the screen says so.
 */
async function findZone({ domain, fetchImpl = fetch } = {}) {
  const labels = String(domain || '').trim().toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return { ok: false, error: 'That is not a domain name.' };

  for (let i = 0; i <= labels.length - 2; i += 1) {
    const candidate = labels.slice(i).join('.');

    const answer = await cfApi(`/zones?name=${encodeURIComponent(candidate)}`, { fetchImpl });

    /* A PERMISSION FAILURE STOPS THE WALK. Without Zone:Read every
     * candidate fails identically, and grinding through all of them to
     * report the same error three times is slower and says less. */
    if (!answer.ok) return { ok: false, error: answer.error };

    const zone = (answer.result || [])[0];
    if (zone && zone.id) return { ok: true, id: zone.id, name: zone.name };
  }

  /* `noZone` MARKS THIS BRANCH, and the marker matters because the caller
   * has to tell two very different failures apart: "this account does not
   * host that domain", which is routine and sometimes intended, and "the
   * token cannot read zones", which is a misconfiguration. Both arrive here
   * as ok:false. Matching on the error TEXT would work until somebody
   * reworded it, which is not a thing anybody would think to check. */
  return { ok: false, noZone: true, error: `No zone in this Cloudflare account matches ${domain}.` };
}

/**
 * Every zone this account holds.
 *
 * ONLY EVER CALLED WHEN A DOMAIN DID NOT MATCH ONE, so it costs nothing on
 * the path where everything is fine. Its whole job is to turn "no zone
 * matches" into "no zone matches, and here is the one you probably meant".
 */
async function listZones({ fetchImpl = fetch } = {}) {
  const answer = await cfApi('/zones?per_page=50', { fetchImpl });

  if (!answer.ok) return { ok: false, error: answer.error };

  return {
    ok: true,
    names: (answer.result || []).map(z => String((z && z.name) || '')).filter(Boolean),
  };
}

/**
 * The domain somebody probably meant.
 *
 * ONE MISTAKE, CAUGHT PRECISELY, rather than fuzzy matching that guesses.
 * Edwin typed `all-bout-hvac-explr-home.com` meaning
 * `all-about-hvac.explr-home.com`: the dot before the zone became a hyphen.
 * That turns a subdomain of a domain he owns into a brand-new .com nobody
 * owns, and nothing noticed until three articles had been written and
 * deployed with canonicals pointing at it.
 *
 * So the test is exact: does the typed domain end with a hyphen followed by
 * a zone this account holds? If it does, that hyphen should have been a dot
 * and we can say so. If it does not, we say nothing — a wrong suggestion is
 * worse than none, because it invites somebody to accept it.
 *
 * PURE. No network, no Cloudflare, so every case is one assertion.
 */
function suggestZoneFix({ domain, zones } = {}) {
  const typed = String(domain || '').trim().toLowerCase();
  const owned = Array.isArray(zones) ? zones : [];

  for (const zone of owned) {
    const name = String(zone || '').trim().toLowerCase();
    if (!name) continue;

    const tail = `-${name}`;

    /* LONGER THAN THE TAIL, not merely ending with it: a domain that IS
     * `-example.com` and nothing else has no subdomain label to rescue. */
    if (typed.length > tail.length && typed.endsWith(tail)) {
      const label = typed.slice(0, typed.length - tail.length);
      return { suggestion: `${label}.${name}`, zone: name };
    }
  }

  return { suggestion: '', zone: '' };
}

/**
 * The CNAME that makes the domain resolve.
 *
 * THIS IS THE STEP THAT WAS MISSING, AND IT COST AN EVENING.
 *
 * Adding a custom domain to a Pages project through the API registers it
 * and nothing more: Cloudflare answers `success: true`, the domain sits at
 * `status: pending`, and it waits for DNS to point at it. The dashboard
 * creates that record for you, which is why this looks automatic when you
 * do it by hand and is not when you do it over the API.
 *
 * So our log said `domainAttached: true` while the browser said
 * DNS_PROBE_FINISHED_NXDOMAIN, and both were telling the truth.
 *
 * PROXIED, WHICH IS NOT OPTIONAL HERE. An unproxied CNAME to pages.dev
 * resolves to Cloudflare's edge without the routing that maps the
 * hostname to this project, and the apex case cannot work at all —
 * CNAME flattening is a proxy feature. Orange cloud or nothing.
 *
 * THE TARGET IS THE DEPLOYMENT'S OWN HOSTNAME, not one built from the
 * project name. Cloudflare does not always give a project the subdomain
 * its name asks for: `appliancerepaircedarpark-com` became
 * `appliancerepaircedarpark-com-bx6` because the name was taken. Derive
 * it and the record is right until the first collision, then points at
 * somebody else's site.
 *
 * AN EXISTING RECORD IS LEFT ALONE. If something already answers at that
 * name, it is not ours to replace — it could be a live site, and a deploy
 * that silently repointed it would be the worst bug in this codebase. The
 * mismatch is reported instead.
 */
async function ensureDnsRecord({ zoneId, name, target, fetchImpl = fetch } = {}) {
  if (!zoneId || !name || !target) return { ok: false, error: 'Nothing to point at.' };

  const existing = await cfApi(
    `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}`,
    { fetchImpl }
  );

  if (!existing.ok) return { ok: false, error: existing.error };

  const already = (existing.result || [])[0];

  if (already) {
    const points = String(already.content || '').replace(/\.$/, '');

    if (points === target && 'CNAME' === already.type) {
      return { ok: true, created: false, note: 'The record was already there.' };
    }

    return {
      ok: false,
      error: `${name} already has a ${already.type} record pointing at ${points}. `
        + 'It was left alone — change or remove it in Cloudflare if the blog should have it.',
    };
  }

  const made = await cfApi(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: 'POST',
    fetchImpl,
    body: { type: 'CNAME', name, content: target, proxied: true, ttl: 1 },
  });

  if (!made.ok) return { ok: false, error: made.error };

  return { ok: true, created: true };
}

/**
 * Point a domain at the project, so the blog is not stuck on pages.dev.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS. A Pages project answers at a name
 * Cloudflare invents — appliancerepaircedarpark-com-bx6.pages.dev — and
 * the blog's own `siteUrl` is the domain somebody typed. Those are two
 * different addresses for one site, and every absolute thing the renderer
 * emits (canonical, og:url, sitemap, RSS) names the second one. Attaching
 * the domain is what makes the two agree.
 *
 * THE REST API, BECAUSE WRANGLER HAS NO COMMAND FOR IT. `wrangler pages`
 * covers projects, deployments and secrets; custom domains are dashboard
 * or API only. So this is the one Cloudflare call in the codebase that is
 * not made by a child process.
 *
 * NON-FATAL, ALWAYS. The domain may not be in this Cloudflare account, the
 * token may lack DNS permission on the zone, or it may already be
 * attached. None of those is a reason to refuse to publish a blog whose
 * articles are written and paid for — the pages.dev address still works
 * and the owner can attach the domain by hand. The outcome is returned and
 * logged rather than thrown.
 *
 * NO RETRY. Cloudflare issues the certificate asynchronously; the response
 * says `initializing` or `pending` and goes active on its own once the DNS
 * record exists. Polling here would hold a job open for a state change
 * that needs nothing from us.
 *
 * REGISTERING IS HALF THE JOB. This call alone leaves the domain pending
 * for ever — see ensureDnsRecord(), which is the other half and the half
 * that was missing.
 */
async function attachDomain({ project, domain, fetchImpl = fetch } = {}) {
  if (!project || !domain) return { ok: false, error: 'No project or domain.' };

  const answer = await cfApi(
    `/accounts/${encodeURIComponent(process.env.CF_ACCOUNT_ID || '')}`
      + `/pages/projects/${encodeURIComponent(project)}/domains`,
    { method: 'POST', body: { name: domain }, fetchImpl }
  );

  if (!answer.ok) return answer;

  return { ok: true, status: (answer.result && answer.result.status) || 'pending' };
}

/**
 * Everything that has to happen for a blog to answer at its own domain.
 *
 * TWO CALLS, AND BOTH ARE REQUIRED. Registering the domain on the project
 * tells Cloudflare which project should serve that hostname; the CNAME
 * tells the internet where the hostname is. Either one alone is a domain
 * that does not work, and the first one alone is a domain that does not
 * work while reporting success.
 *
 * THE DNS HALF IS ALLOWED TO FAIL ON ITS OWN. The zone may be in another
 * Cloudflare account, or the token may have Pages but not Zone
 * permissions — which is exactly the state Edwin's token was in. Neither
 * is a reason to undo the attach or to fail a deploy: the pages.dev
 * address serves the blog, and the record is one row in a dashboard. What
 * matters is that the screen says so instead of claiming success.
 */
async function pointDomainAtProject({
  project, domain, target, fetchImpl = fetch, redirect = null,
} = {}) {
  const attached = await attachDomain({ project, domain, fetchImpl });

  /* THE pages.dev REDIRECT, REQUIRED LAZILY, AND THAT IS NOT LAZINESS.
   *
   * redirects.js needs cfApi() and scrub() from THIS file, so requiring it
   * at the top would be a cycle: each module would see the other half
   * initialised, depending on which got loaded first, and the symptom is
   * `cfApi is not a function` in whichever order production happens to
   * pick. Required at call time, both modules are whole.
   *
   * It is also injectable, so a test can pass its own without reaching
   * through a module cache. */
  const sendRedirect = redirect
    || ((args) => require('./redirects').redirectPagesDev(args));

  /* NOT GATED ON THE DNS WORKING, and not allowed to stop it either. The
   * redirect lives in an account-level list and has nothing to do with
   * this domain's zone — a blog whose DNS is somebody else's problem still
   * wants its pages.dev address pointed home. */
  const pagesDev = await sendRedirect({ project, domain, fetchImpl });

  const zone = await findZone({ domain, fetchImpl });
  if (!zone.ok) {
    return { attached, pagesDev, dns: { ok: false, error: zone.error }, url: `https://${domain}/` };
  }

  const dns = await ensureDnsRecord({ zoneId: zone.id, name: domain, target, fetchImpl });

  return { attached, pagesDev, dns, zone: zone.name, url: `https://${domain}/` };
}

/**
 * Unlink one hostname from one Pages project.
 *
 * WHAT THIS DOES NOT TOUCH, because the question was asked and it is the
 * right question: the zone. Removing a custom domain from a Pages project
 * severs the link between THAT HOSTNAME and THAT PROJECT. The domain
 * stays in Cloudflare, the root stays exactly as it is, and every other
 * subdomain carries on. Edwin runs a live blog on the same domain and
 * asked whether this would take it down. It cannot: it addresses one
 * hostname by name.
 *
 * IT HAS TO HAPPEN BEFORE THE PROJECT IS DELETED. Cloudflare refuses to
 * delete a project that is still serving an active custom domain — which
 * is why `all-about-roofing-explr-home-com` survived its delete while the
 * earlier projects, whose domains were still pending, did not.
 */
async function detachDomain({ project, domain, fetchImpl = fetch } = {}) {
  if (!project || !domain) return { ok: false, error: 'No project or domain.' };

  return cfApi(
    `/accounts/${encodeURIComponent(process.env.CF_ACCOUNT_ID || '')}`
      + `/pages/projects/${encodeURIComponent(project)}`
      + `/domains/${encodeURIComponent(domain)}`,
    { method: 'DELETE', fetchImpl }
  );
}

/**
 * Delete the CNAME we made, and ONLY the CNAME we made.
 *
 * THE MOST DANGEROUS FUNCTION IN THIS FILE, which is why it is the
 * fussiest. It runs inside a delete, against a zone that may hold a
 * business's whole internet presence, and the thing it is reaching for is
 * one row among dozens.
 *
 * TWO LOCKS, AND BOTH MUST OPEN:
 *
 *   the NAME is the blog's own hostname, exactly — never a parent, never
 *   a wildcard, never a near miss;
 *
 *   the CONTENT is the pages.dev host this blog deploys to. A CNAME at
 *   the right name pointing somewhere else is somebody's repurposed
 *   subdomain, and it is not ours to remove.
 *
 * ensureDnsRecord() refuses to OVERWRITE a record it did not create. This
 * is the same rule facing the other way, and it matters more: an
 * overwrite is visible and reversible, a delete of a record nobody has a
 * copy of is neither.
 *
 * A MISSING RECORD IS A SUCCESS. Somebody may have cleaned up by hand, or
 * the deploy may never have got that far. Either way there is nothing to
 * do and nothing to report as broken.
 */
async function removeDnsRecord({ zoneId, name, expected, fetchImpl = fetch } = {}) {
  if (!zoneId || !name) return { ok: false, error: 'Nothing to remove.' };

  const found = await cfApi(
    `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}`,
    { fetchImpl }
  );

  if (!found.ok) return { ok: false, error: found.error };

  const record = (found.result || [])[0];
  if (!record) return { ok: true, removed: false, note: 'There was no record to remove.' };

  const points = String(record.content || '').replace(/\.$/, '');

  if ('CNAME' !== record.type || (expected && points !== expected)) {
    return {
      ok: false,
      error: `${name} is a ${record.type} record pointing at ${points}, which is not `
        + 'this blog\'s. It was left alone.',
    };
  }

  const gone = await cfApi(
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`,
    { method: 'DELETE', fetchImpl }
  );

  if (!gone.ok) return { ok: false, error: gone.error };

  return { ok: true, removed: true };
}

/**
 * Undo everything pointDomainAtProject() did.
 *
 * THE MIRROR, AND IT WAS MISSING. The app created a Pages project, a
 * custom domain and a DNS record, and deleting a blog removed none of
 * them. Every deleted blog left three things behind in Cloudflare that
 * nothing in the app could ever reach again — the project holding its
 * pages.dev name for ever, and a CNAME pointing at it.
 *
 * ORDER MATTERS ONCE: the domain comes off the project before the
 * project is deleted, because Cloudflare refuses otherwise. The DNS
 * record can go at any point; it goes last so that a failure there
 * leaves the least behind.
 *
 * NOTHING HERE IS FATAL. A blog that cannot be deleted because Cloudflare
 * is having a bad morning is worse than some tidying left undone. Each
 * step reports itself and the caller decides what to say.
 */
async function releaseDomain({
  project, domain, expected, fetchImpl = fetch, release = null,
} = {}) {
  const detached = await detachDomain({ project, domain, fetchImpl });

  /* Lazily required for the same reason as in pointDomainAtProject above. */
  const dropRedirect = release
    || ((args) => require('./redirects').releasePagesDev(args));

  /* BEFORE THE ZONE LOOKUP, because the redirect is account-level and does
   * not need one. A blog on a domain this account does not host would
   * otherwise leave its entry in the shared list for ever — and that list
   * is the one thing here every blog shares. */
  const pagesDev = await dropRedirect({ project, domain, fetchImpl });

  const zone = await findZone({ domain, fetchImpl });
  if (!zone.ok) return { detached, pagesDev, dns: { ok: false, error: zone.error } };

  const dns = await removeDnsRecord({ zoneId: zone.id, name: domain, expected, fetchImpl });

  return { detached, pagesDev, dns, zone: zone.name };
}

/**
 * Put a rendered blog on Cloudflare Pages.
 *
 * @param {object}   opts
 * @param {object}   opts.blog     the BlogSite
 * @param {object}   opts.files    path -> contents, the whole site
 * @param {string}   opts.requestId
 * @param {function} opts.run      injected for tests
 *
 * @returns {{ ok: true, url, project, files }} | { ok: false, error }
 *
 * THE DIRECTORY IS ALWAYS REMOVED, win or lose. A failed deploy that left
 * its files behind would fill the disk one blog at a time, and the disk on
 * this box is also where every generated website lives.
 */
async function deployBlog({ blog, files, requestId, run = runWrangler, attach = pointDomainAtProject } = {}) {
  const project = blog && blog.project ? String(blog.project) : projectNameFor(blog);
  const names = Object.keys(files || {});

  if (!names.length) {
    return { ok: false, error: 'There is nothing to deploy yet.' };
  }

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ie-pages-'));

  try {
    await writeSite(root, files);

    const started = Date.now();
    const env = childEnv();

    /* THE FIRST DEPLOY SETS THE BLOG UP; EVERY LATER ONE JUST DEPLOYS.
     *
     * `blog.project` is written after the first successful deploy and read
     * on every one after, so its emptiness already means "this blog has
     * never been published". That makes it the signal for the setup work,
     * at no cost: no extra API call on the hundredth deploy of a blog that
     * has been live for a year.
     *
     * IT CAN RUN TWICE, AND THAT IS FINE. If the create succeeds and the
     * deploy then fails, `project` is never stored, so the next attempt
     * tries to create again. Both steps are written to tolerate having
     * already happened — which is why neither of them can fail the deploy.
     *
     * ONLY THE PROJECT IS MADE HERE. The domain work waits until after
     * the deploy, and that is not tidiness: the CNAME has to point at the
     * project's REAL pages.dev hostname, which Cloudflare only reveals in
     * the deploy output. Built from the project name instead it would be
     * right until the first name collision — the one that turned
     * appliancerepaircedarpark-com into appliancerepaircedarpark-com-bx6
     * — and then point at a stranger's site.
     */
    const firstTime = !(blog && blog.project);
    let setup = null;

    if (firstTime) {
      const made = await ensureProject({ project, env, run });
      setup = { created: made.created, createOutput: made.output };
    }

    const result = await run(
      ['pages', 'deploy', root, `--project-name=${project}`, '--branch=main', '--commit-dirty=true'],
      { env, cwd: root }
    );

    const output = scrub(`${result.stdout}\n${result.stderr}`);

    if (0 !== result.code) {
      /* THE CREATE'S OUTPUT TOO, WHEN THERE WAS ONE. A deploy that fails
       * right after a failed create fails BECAUSE of it — "project does
       * not exist" with no explanation of why it was not made is the
       * error Edwin spent an evening on. */
      const full = setup && !setup.created
        ? `${setup.createOutput}\n${output}`
        : output;

      /* THE ONE PUBLISH FAILURE A RETRY ACTUALLY FIXES, SAID OUT LOUD.
       *
       * 19 October: a 10-article campaign died on `[code: 8000000]` —
       * Cloudflare's own "unknown error", carrying no detail at all — and
       * the screen showed two raw wrangler errors with no hint that the
       * second was merely the consequence of the first. Hours later the
       * same publish worked, untouched. Waiting was the whole fix, and
       * nothing on the page said so.
       *
       * BOTH HALVES, OR NOTHING. ensureProject() returns created:false for
       * a refusal AND for a project that was already there, and it refuses
       * on purpose to tell those apart — so "the create did not succeed"
       * cannot carry this on its own. The deploy saying the project is
       * missing cannot either: on an established blog that means somebody
       * deleted it in the dashboard, which no amount of waiting mends.
       * Together they mean one thing: the project is genuinely absent,
       * that is genuinely why the deploy failed, and a retry is genuinely
       * the right advice.
       *
       * A REGEX ON WRANGLER'S OWN SENTENCE, which is the same bargain
       * urlFrom() makes two screens down. If wrangler rewords it this goes
       * quiet and the screen falls back to what it showed before — a lost
       * hint, not a broken publish. */
      const projectMissing = !!(
        setup && !setup.created
        && /pages project[\s\S]{0,200}does not exist/i.test(output)
      );

      log.error('blog.deploy.failed', new Error(`wrangler exited ${result.code}`), {
        requestId,
        siteId: String((blog && blog._id) || ''),
        project,
        files: names.length,
        projectMissing,
        output: full.slice(-2000),
      });

      return {
        ok: false,
        error: 'The deploy to Cloudflare did not finish.',
        output: full,
        projectMissing,
      };
    }

    /* THE DEPLOYMENT'S OWN ADDRESS, AND THE ONE THAT OUTLIVES IT.
     *
     *   deploymentUrl   de7c47e4.<project>.pages.dev — this deploy, for ever
     *   url             <project>.pages.dev — whatever is newest
     *
     * The screen stores one of these and shows it as "View it". It used to
     * store the first, and the first is wrong for that job twice over: the
     * hash changes on every publish, so yesterday's link shows yesterday's
     * site; and on a brand-new project it 404s on TLS for a few minutes,
     * because `*.pages.dev` is a one-level wildcard and that address is
     * two levels deep. Edwin clicked it the night the first deploy worked
     * and got ERR_SSL_VERSION_OR_CIPHER_MISMATCH on a site that was live.
     *
     * DERIVED FROM THE HASHED ONE RATHER THAN BUILT FROM THE PROJECT NAME.
     * Cloudflare does not always give a project the subdomain its name
     * asks for — appliancerepaircedarpark-com became
     * appliancerepaircedarpark-com-bx6, because the subdomain has to be
     * unique across all of Cloudflare and that one was taken. Build the
     * address from `project` and it would be right until the first
     * collision, then confidently wrong. Dropping the first label off what
     * wrangler printed cannot be. */
    const deploymentUrl = urlFrom(output);
    const url = deploymentUrl
      ? deploymentUrl.replace(/^https:\/\/[^.]+\./, 'https://')
      : null;

    /* THE DOMAIN, NOW THAT THE PROJECT'S REAL HOSTNAME IS KNOWN.
     *
     * Registering the domain on the project and creating the CNAME that
     * makes it resolve. Both live in pointDomainAtProject(); the comment
     * there explains why one without the other is a domain that reports
     * success and returns NXDOMAIN.
     *
     * AFTER A SUCCESSFUL DEPLOY, NEVER BEFORE. The CNAME target is the
     * hostname wrangler just printed, stripped of its deployment hash.
     * There is nothing to point at until something has been deployed.
     *
     * NOTHING HERE CAN FAIL THE PUBLISH. The articles are up and paid
     * for; a zone in another account or a token short of Zone:DNS:Edit
     * means the owner adds one row in a dashboard. The outcome travels
     * back so the screen can say which. */
    if (firstTime && url) {
      const domain = String((blog && blog.siteUrl) || '');
      const target = url.replace(/^https:\/\//, '').replace(/\/$/, '');

      const pointed = await attach({ project, domain, target });
      setup = Object.assign({}, setup, pointed);

      log.info('blog.deploy.firstTime', {
        requestId,
        siteId: String((blog && blog._id) || ''),
        project,
        projectCreated: Boolean(setup.created),
        domainAttached: Boolean(pointed.attached && pointed.attached.ok),
        /* THE TWO HALVES REPORTED SEPARATELY, BECAUSE THEY FAILED
         * SEPARATELY. The log said domainAttached: true while the browser
         * said NXDOMAIN, and both were right — the domain was registered
         * and the DNS record was never made. One field could not have
         * told that story. */
        dnsCreated: Boolean(pointed.dns && pointed.dns.ok),
        dnsTarget: target,
        attachError: pointed.attached && pointed.attached.ok ? '' : String((pointed.attached || {}).error || ''),
        dnsError: pointed.dns && pointed.dns.ok ? '' : String((pointed.dns || {}).error || ''),
      });
    }

    log.info('blog.deploy.ok', {
      requestId,
      siteId: String((blog && blog._id) || ''),
      project,
      files: names.length,
      ms: Date.now() - started,
      url: url || '',
      deploymentUrl: deploymentUrl || '',
    });

    return { ok: true, url, deploymentUrl, project, files: names.length, setup };

  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  deployBlog, projectNameFor, resolveInside, writeSite, scrub, urlFrom, childEnv,
  wranglerEntry, runWrangler, ensureProject, attachDomain, deleteProject,
  cfApi, findZone, listZones, suggestZoneFix, ensureDnsRecord, pointDomainAtProject,
  detachDomain, removeDnsRecord, releaseDomain,
};
