// utils/blog/siteUrlGuard.js
//
// Stops the scheduler being used to attack our own network.
//
// THE PROBLEM
//
// BlogSite.siteUrl is reported BY THE PLUGIN. Anyone who activates a licence
// can report whatever address they like, and the scheduler will then make an
// authenticated POST to it, from inside our infrastructure. That is
// server-side request forgery, and on a cloud host the first thing an attacker
// reaches for is the instance metadata service:
//
//     http://169.254.169.254/latest/meta-data/iam/security-credentials/
//
// which hands out credentials to anything that can make an HTTP request from
// the instance. Other targets: a database admin panel on 127.0.0.1, an
// internal service on 10.x, a Redis instance with no password.
//
// WHAT THIS DOES
//
//   1. Only http and https. No file:, gopher:, ftp: — the classic bypasses.
//   2. Only ports 80 and 443.
//   3. Resolves the hostname and rejects EVERY address it maps to if any is
//      private, loopback, link-local, or otherwise not a public host.
//   4. Rejects hostnames with no public address at all.
//
// The caller must also refuse redirects. A permitted public host answering
// with `302 Location: http://169.254.169.254/` walks straight through every
// check above, because the check ran against the original URL. See
// blogScheduler.js, which passes redirect: 'manual'.
//
// WHAT IT DOES NOT DO
//
// DNS rebinding. A hostname can resolve to a public address when we check and
// a private one microseconds later when the socket opens, because those are
// two separate lookups. Closing that properly means dialling the validated IP
// yourself and carrying the Host header, which breaks TLS certificate
// validation unless you also pin the servername — a real amount of machinery.
//
// It is left open deliberately, and the reasoning is worth recording: the only
// thing sent to a site is a wake-up POST containing that site's own campaign
// id, signed with that site's own secret. There is nothing in the request an
// attacker does not already have. The exposure is the ability to make our
// server issue one POST to an internal address and learn nothing about the
// response — the scheduler reads only the status code. Revisit this the moment
// anything richer is sent, or any response content is acted upon.

const dns = require('dns').promises;
const net = require('net');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

/**
 * IPv4 ranges that must never be dialled.
 *
 * Written as [firstOctet, mask, value] tests rather than CIDR parsing, so
 * there is no dependency and each line can be read against its RFC.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;   // unparseable: refuse rather than guess
  }

  const [a, b] = parts;

  if (a === 0) return true;                      // 0.0.0.0/8      "this network"
  if (a === 10) return true;                     // 10.0.0.0/8     private
  if (a === 127) return true;                    // 127.0.0.0/8    loopback
  if (a === 169 && b === 254) return true;       // 169.254.0.0/16 link-local — CLOUD METADATA
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12  private
  if (a === 192 && b === 168) return true;       // 192.168.0.0/16 private
  if (a === 192 && b === 0) return true;         // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51) return true;        // 198.51.100.0/24 documentation
  if (a === 203 && b === 0) return true;         // 203.0.113.0/24  documentation
  if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 CGNAT
  if (a >= 224) return true;                     // 224.0.0.0/4 multicast, 240/4 reserved

  return false;
}

function isPrivateIPv6(ip) {
  const addr = ip.toLowerCase().split('%')[0];   // strip any zone index

  if (addr === '::' || addr === '::1') return true;      // unspecified, loopback

  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible. Without this, an
  // attacker reaches a private IPv4 address wearing an IPv6 hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPrivateIPv4(mapped[1]);

  if (/^f[cd]/.test(addr)) return true;          // fc00::/7  unique local
  if (/^fe[89ab]/.test(addr)) return true;       // fe80::/10 link-local
  if (/^ff/.test(addr)) return true;             // ff00::/8  multicast

  return false;
}

function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;   // not an IP at all: refuse
}

/**
 * Is this URL safe for the scheduler to call?
 *
 * @param {string} rawUrl
 * @returns {Promise<{ok: boolean, reason?: string, url?: URL, addresses?: string[]}>}
 */
async function checkSiteUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch (_) {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `protocol ${url.protocol} is not allowed` };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: `port ${url.port} is not allowed` };
  }

  // An address given as a literal skips DNS entirely, so check it directly.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    return isPrivateAddress(literal)
      ? { ok: false, reason: `${literal} is not a public address` }
      : { ok: true, url, addresses: [literal] };
  }

  let resolved;
  try {
    resolved = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch (err) {
    return { ok: false, reason: `could not resolve ${url.hostname}` };
  }

  if (!resolved.length) {
    return { ok: false, reason: `${url.hostname} has no addresses` };
  }

  // EVERY address must be public, not just the first. A hostname resolving to
  // both a public and a private address would otherwise be a coin toss decided
  // by whichever the connection happens to pick.
  const addresses = resolved.map(r => r.address);
  const bad = addresses.find(isPrivateAddress);

  if (bad) {
    return { ok: false, reason: `${url.hostname} resolves to ${bad}, which is not public` };
  }

  return { ok: true, url, addresses };
}

module.exports = { checkSiteUrl, isPrivateAddress, isPrivateIPv4, isPrivateIPv6 };