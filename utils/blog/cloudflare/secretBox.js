// utils/blog/cloudflare/secretBox.js
//
// Storing a Cloudflare API token we have to be able to USE again.
//
// ENCRYPTION, NOT HASHING, AND THAT IS THE FIRST QUESTION TO ASK
//
// Licence keys in this system are hashed — SHA-256 and the last four —
// because nothing ever needs the original back: a key is only compared
// against one somebody typed. That is the right shape for a secret you
// VERIFY.
//
// A Cloudflare token is the opposite. The server presents it to Cloudflare on
// every deploy, so it has to come back out. A hashed token is a token nobody
// can use, including us.
//
// WHAT THIS DOES AND DOES NOT PROTECT
//
// It does not protect against a compromised server. The key is on that
// server; anyone who can run code there can decrypt. Saying otherwise would
// be the kind of security theatre that stops people asking the real question.
//
// It protects against everything short of that, which is most of what
// actually happens: a database backup on somebody's laptop, a Mongo instance
// briefly exposed, a dump attached to a support ticket, a stolen Atlas
// snapshot. Ten customers' Cloudflare tokens in plaintext in a collection is
// a different kind of bad day from ten encrypted ones.
//
// AES-256-GCM, SO TAMPERING IS DETECTED RATHER THAN DECRYPTED
//
// An unauthenticated mode hands back plausible rubbish for an edited
// ciphertext, and the first thing anybody would do with the result is send it
// to Cloudflare — which answers with an authentication failure that reads
// like a revoked token. The tampering never surfaces. GCM's tag turns that
// into an error at the point it happened.

'use strict';

const crypto = require('crypto');

/** AES-256. Stated rather than implied, so the setup note cannot drift. */
const KEY_BYTES = 32;

/** 96 bits, which is what GCM is specified around. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/* A VERSION BYTE, BECAUSE THE FIRST SCHEME IS NEVER THE LAST ONE.
 *
 * It costs one byte and it is what makes a future change survivable: a
 * reader can tell a v1 value from a v2 one and decrypt each correctly,
 * instead of the whole collection having to be rewritten in one go by a
 * migration that must not be interrupted. */
const VERSION = 1;

/**
 * The key, read at CALL time.
 *
 * NOT CACHED AT LOAD, and that is deliberate twice over. A module that read
 * its key once at require() would be permanently broken on a server that
 * loaded it before the environment was populated — and the symptom is
 * "encryption is off", which nobody notices. It also makes rotating the key
 * a restart rather than a redeploy.
 *
 * REFUSED RATHER THAN DEFAULTED. A seal() that returned the plaintext when
 * no key was configured would work perfectly in development and then write
 * ten live Cloudflare tokens into the database in clear on the first server
 * missing the variable. Nothing would look wrong.
 */
function key() {
  const raw = process.env.CF_TOKEN_KEY;

  if (!raw) {
    throw new Error(
      'CF_TOKEN_KEY is not set on this server. '
      + 'Generate one with: openssl rand -hex 32');
  }

  const bytes = /^[0-9a-f]+$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (bytes.length !== KEY_BYTES) {
    /* THE LENGTH IS NAMED AND THE KEY IS NOT. Half a key is not half the
     * security, it is an error at a random later moment — and the most
     * likely cause is `openssl rand -hex 16` instead of 32. */
    throw new Error(
      `CF_TOKEN_KEY must be ${KEY_BYTES} bytes `
      + `(${KEY_BYTES * 2} hex characters); this one decodes to ${bytes.length}`);
  }

  return bytes;
}

/**
 * Plaintext -> a base64 blob safe to store.
 *
 * Layout: version | iv | tag | ciphertext. One string, because a document
 * field that is three fields is three chances for two of them to be updated.
 *
 * A FRESH IV EVERY TIME, which is not a formality here: ten accounts' rows
 * sit in one collection, and identical ciphertext would tell anyone reading
 * the database that two customers gave us the same token.
 */
function seal(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);

  const body = Buffer.concat([
    cipher.update(String(plaintext == null ? '' : plaintext), 'utf8'),
    cipher.final(),
  ]);

  return Buffer.concat([
    Buffer.from([VERSION]), iv, cipher.getAuthTag(), body,
  ]).toString('base64');
}

/** Whether a stored value came out of seal(). */
function isSealed(value) {
  if ('string' !== typeof value || !value) return false;

  /* ROUND-TRIPPED THROUGH BASE64 RATHER THAN PATTERN-MATCHED. Buffer.from
   * is famously forgiving — it skips characters it does not recognise
   * rather than refusing — so a plain token decodes to SOMETHING and a
   * length check alone would call it sealed. */
  let bytes;
  try { bytes = Buffer.from(value, 'base64'); } catch (err) { return false; }

  if (bytes.toString('base64') !== value) return false;
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES) return false;

  return VERSION === bytes[0];
}

/**
 * A stored blob -> the plaintext.
 *
 * THROWS ON ANYTHING IT DID NOT PRODUCE, including a plaintext token written
 * straight into the field by a script or by somebody editing the database.
 * Returning that unchanged would be the convenient thing and it would void
 * the only guarantee this module makes — that what comes out went in.
 *
 * NOTHING SECRET IN THE MESSAGE. These errors are thrown inside the deploy
 * path and end up in the log, which is the one place a token must never be.
 * The cause is named; the values are not.
 */
function open(sealed) {
  const k = key();

  if (!isSealed(sealed)) {
    throw new Error('That stored Cloudflare token could not be read: it is not in the sealed format');
  }

  const bytes = Buffer.from(sealed, 'base64');

  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const body = bytes.subarray(1 + IV_BYTES + TAG_BYTES);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch (err) {
    /* THE ORIGINAL ERROR IS NOT PASSED ON. Node's message for a failed tag
     * check is "Unsupported state or unable to authenticate data", which
     * tells a reader nothing about what to do — and the two real causes
     * want different actions: a rotated key means re-enter the tokens, a
     * tampered row means look at the database. */
    throw new Error(
      'That stored Cloudflare token could not be read. '
      + 'Either CF_TOKEN_KEY has changed since it was saved, or the stored value was altered.');
  }
}

module.exports = { seal, open, isSealed, KEY_BYTES };
