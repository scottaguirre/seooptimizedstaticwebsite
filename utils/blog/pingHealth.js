// utils/blog/pingHealth.js
//
// WHAT HAPPENED LAST TIME WE KNOCKED, IN WORDS SOMEBODY CAN ACT ON.
//
// Everything here was already being stored and none of it was shown anywhere.
// On 12 October Edwin's counter sat at "0 of 22" for a whole batch; finding
// out why took an SSH session, a grep over ~/app/logs/app.log, a dig, and a
// curl. The answer — a Cloudflare challenge page served by his host — was
// sitting in site.lastPingError the entire time, in full, because
// whatItSaid() had captured the body three weeks earlier.
//
// That is survivable for the person who wrote the server. It is not
// survivable when a CUSTOMER emails to say the posts never arrived, which was
// Edwin's own question: "how am I going to be able to diagnose the problem?"
//
// So this turns the stored reason into a state, a sentence, and the specific
// thing to ask the host for. The three causes below are not invented: each
// one cost a day of this project.
//
// ---------------------------------------------------------------------------
// WHY THIS DOES NOT READ pingFailures, WHICH IS THE OBVIOUS FIELD
//
// requireSite.js resets pingFailures to 0 on every authenticated inbound
// request, deliberately and correctly: a site that is talking to us is
// reachable, and the scheduler should not give up on it because our outbound
// pings are blocked.
//
// The consequence is that on a site anybody is using, pingFailures is a
// sawtooth. Edwin's log shows it climbing 1, 2, 3 and dropping back to 1 all
// morning — every "Check now" press reset it — so it never came near
// MAX_PING_FAILURES, the server never gave up, and no "givingUp" line was ever
// logged. A health screen keyed on that counter would have reported a blocked
// site as healthy, which is worse than no screen.
//
// lastPingError is the honest field. The scheduler clears it on success and
// writes it on failure, and requireSite does not touch it — so a non-empty
// value means THE LAST PING ATTEMPT FAILED, however many times the plugin has
// phoned in since.

'use strict';

/** Longest reason we will put on a screen, after the scheduler's own cap. */
const DETAIL_CHARS = 400;

/**
 * One rule per cause we have actually met.
 *
 * ORDER MATTERS. A Cloudflare challenge is an HTTP 403 and mod_security often
 * answers 403 too, so the body is what separates them — the more specific
 * test has to run first. Everything falls through to a generic answer rather
 * than guessing: telling somebody to ring their host about the wrong thing
 * costs more than admitting we do not know.
 */
const CAUSES = [
  {
    state: 'challenged',
    when: r => /^HTTP (403|503)/.test(r) && /just a moment|cf-ray|cloudflare|attention required|checking your browser/i.test(r),
    label: 'Blocked by a bot challenge',
    action:
      'A Cloudflare challenge is answering instead of WordPress, so nothing reaches the site. '
      + 'Many hosts switch this on themselves — it can be absent from cPanel and from the DNS. '
      + 'Ask the host to allow our server through, by IP or by exempting /wp-json/.',
  },
  {
    state: 'blocked',
    when: r => /^HTTP (401|403|406)/.test(r) && /mod_?security|not acceptable|forbidden|access denied/i.test(r),
    label: 'Blocked by a firewall',
    action:
      'The host\'s firewall is refusing the request before WordPress sees it — usually mod_security. '
      + 'Ask the host to whitelist our server for /wp-json/. They will need the exact time of a '
      + 'refusal to find it in their log; the timestamp below is one.',
  },
  {
    state: 'signature',
    when: r => /ie_bad_signature|signature did not match/i.test(r),
    label: 'The site did not recognise us',
    action:
      'The site answered, but rejected our signature. Two causes, and they are not alike: the '
      + 'licence key was replaced without reconnecting the plugin, or the site is in a subfolder '
      + 'and the recorded address is missing it — in which case some OTHER WordPress is answering. '
      + 'Check the address on this row is the one with wp-config.php in it.',
  },
  {
    state: 'missing',
    when: r => /^HTTP 404/.test(r),
    label: 'Nothing answered at that address',
    action:
      'The address is reachable but has no plugin at it. Either the plugin is deactivated, or the '
      + 'recorded address is wrong — a subfolder install recorded as the bare domain does exactly this.',
  },
  {
    state: 'erroring',
    when: r => /^HTTP 5\d\d/.test(r),
    label: 'The site errored',
    action:
      'WordPress itself failed. In this project that has meant a broken .htaccess taking the whole '
      + 'REST API down — fixed by opening Settings → Permalinks and pressing Save, which rewrites '
      + 'the file — and, separately, mod_security. Worth trying the Permalinks save first; it costs nothing.',
  },
  {
    state: 'redirected',
    when: r => /^redirected/.test(r),
    label: 'The address redirects',
    action:
      'We refuse to follow redirects on purpose: a redirect can send a signed request somewhere it '
      + 'was never meant to go. Record the address the site actually settles on — usually the www '
      + 'or https version.',
  },
  {
    state: 'timeout',
    when: r => /^timed out/.test(r),
    label: 'No answer in time',
    action:
      'The site did not reply within ten seconds. An overloaded shared host does this, and so does '
      + 'a firewall that drops the packet rather than refusing it. If it is persistent, ask the host.',
  },
  {
    state: 'unsafe',
    when: r => /^unsafe url/.test(r),
    label: 'The address failed our safety check',
    action:
      'The address resolves somewhere we will not send a signed request — a private or internal '
      + 'network. This is our guard working, not the site being down.',
  },
];

/** The generic answer, for a reason we have not met before. */
const UNKNOWN = {
  state: 'unreachable',
  label: 'Could not be reached',
  action:
    'We could not get a reply. The reason is below exactly as it came back — if this is a cause we '
    + 'have not seen before, it belongs in pingHealth.js so the next person does not have to work it out.',
};

/**
 * Tidy a stored reason for display.
 *
 * It contains whatever the far end sent, which is untrusted and was already
 * stripped of tags and control characters by whatItSaid(). This only bounds
 * the length again: lastPingError holds 400 characters and a table cell is
 * not the place to discover that.
 */
function readable(reason) {
  const flat = String(reason || '').replace(/\s+/g, ' ').trim();

  return flat.length > DETAIL_CHARS ? `${flat.slice(0, DETAIL_CHARS)}…` : flat;
}

/**
 * How is the server getting on with this site?
 *
 * @param  {object} site a BlogSite, lean or hydrated
 * @return {{state: string, ok: boolean, label: string, detail: string,
 *           action: string, lastOk: (Date|null), lastTried: (Date|null)}}
 */
function pingHealth(site) {
  const s = site || {};
  const reason = readable(s.lastPingError);

  const lastOk = s.lastPingOkAt || null;
  const lastTried = s.lastPingAt || null;

  /* A REVOKED LICENCE IS NOT A FAULT. It stops being pinged by design, and
   * its last recorded error — however alarming — is from before it was turned
   * off. Reporting that as a problem to chase would send somebody to their
   * host about a site they themselves disconnected. */
  if ('revoked' === s.status) {
    return {
      state: 'revoked',
      ok: false,
      label: 'Revoked',
      detail: '',
      action: '',
      lastOk,
      lastTried,
    };
  }

  if (!reason) {
    /* NOTHING TO REPORT IS NOT THE SAME AS WORKING, and the difference is a
     * brand new site. lastPingError is empty on a record that has never been
     * contacted, exactly as it is on one contacted successfully a minute ago.
     * Saying "fine" about a site we have never reached is the kind of
     * reassurance that gets found out later. */
    if (!lastTried && !lastOk) {
      return {
        state: 'quiet',
        ok: true,
        label: 'Not contacted yet',
        detail: '',
        action:
          'We only knock when there is something to do — a batch being written, posts waiting to '
          + 'be collected, or a scheduled post that is late. A new site stays quiet until then.',
        lastOk,
        lastTried,
      };
    }

    return {
      state: 'ok',
      ok: true,
      label: 'Reaching it',
      detail: '',
      action: '',
      lastOk,
      lastTried,
    };
  }

  const cause = CAUSES.find(c => c.when(reason)) || UNKNOWN;

  return {
    state: cause.state,
    ok: false,
    label: cause.label,
    detail: reason,
    action: cause.action,
    lastOk,
    lastTried,
  };
}

/* -------------------------------------------------------------------------
 * The two bits of markup, HERE RATHER THAN IN THE ROUTE
 *
 * Not tidiness. A template literal inside a 100-line row builder inside a
 * route handler cannot be called by a test without stubbing Express, a
 * session, two models and the CSRF field — so in practice it would not be
 * tested at all, and the only guard left would be a test that greps the route
 * for a function name. Source searches have missed seven real bugs in this
 * project. Moving these two functions next to the rule they render makes them
 * ordinary functions with arguments and a return value.
 * ---------------------------------------------------------------------- */

/** The route has its own copy of this; both are deliberate, neither is clever. */
function escape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A date AND a time, because a firewall log is searched by the minute.
 *
 * The list's other dates print as dates, which is right for "last seen" and
 * useless for the one thing a host asks: when exactly were you refused.
 */
function stamp(date) {
  return date ? escape(new Date(date).toLocaleString()) : '';
}

/**
 * How the ping is getting on, as a badge.
 *
 * NOT A TRAFFIC LIGHT WITH TWO COLOURS. "Not contacted yet" is neither good
 * nor bad — we only knock when there is work — and colouring it red would
 * send somebody to their host about a new site behaving perfectly.
 */
function healthBadge(health) {
  const h = health || {};

  const colour = {
    ok: 'bg-success',
    quiet: 'bg-light text-dark border',
    revoked: 'bg-secondary',
  }[h.state] || 'bg-danger';

  return `<span class="badge ${colour}">${escape(h.label)}</span>`;
}

/**
 * The second row, under a site that is not being reached.
 *
 * WHY A WHOLE ROW AND NOT A TOOLTIP. This text gets forwarded to a host, so it
 * has to be selectable and readable without hovering. The question this page
 * exists to answer was "if a user reaches out to me, how am I going to
 * diagnose the problem?" — the answer has to be something you can copy.
 *
 * THE SITE'S OWN WORDS ARE SHOWN VERBATIM, escaped. They are untrusted input
 * from somebody else's server: whatItSaid() stripped tags and control
 * characters on the way in, escape() is what stops the rest, and readable()
 * bounds the length. Summarising them further would have hidden the phrase
 * that solved this — "Just a moment…" was the whole diagnosis, thirteen
 * characters into a four-hundred-character body.
 */
function healthDetail(health, columns) {
  const h = health || {};

  if (h.ok || 'revoked' === h.state) return '';

  const tried = stamp(h.lastTried);
  const lastOk = h.lastOk
    ? `Last got through ${stamp(h.lastOk)}.`
    : 'We have never got through to this site.';

  return `
    <tr class="border-0">
      <td colspan="${Number(columns) || 1}" class="pt-0 small">
        <div class="border-start border-danger border-3 ps-3 py-1">
          <div>${escape(h.action)}</div>
          <div class="mt-2 text-muted">${lastOk}${tried ? ` Last tried ${tried}.` : ''}</div>
          <div class="mt-2"><code class="text-danger">${escape(h.detail)}</code></div>
        </div>
      </td>
    </tr>`;
}

module.exports = { pingHealth, readable, healthBadge, healthDetail, DETAIL_CHARS };
