<?php
/**
 * The signature scheme, in one place, for both directions.
 *
 * WHY ONE FILE
 *
 * This plugin signs its outbound calls and verifies the server's inbound
 * pings. Those are the same algorithm run in opposite directions, and writing
 * them separately is how they come to disagree — at which point everything
 * fails with "signature did not match" and no indication which side is wrong.
 *
 * THE CANONICAL STRING
 *
 *     timestamp \n METHOD \n path \n sha256(body)
 *
 * The method and path are inside the signature deliberately. Without them, a
 * signature captured from a harmless call could be replayed against a
 * different endpoint — the classic way this scheme is got wrong.
 *
 * The body is HASHED rather than included, so the string being signed stays a
 * fixed length whatever the payload.
 *
 * THE ONE THING THAT WILL BITE YOU
 *
 * The hash must be taken over the EXACT BYTES sent on the wire. Encoding a
 * payload, signing that string, and then letting something re-encode it before
 * transmission produces a signature for a body that was never sent. So
 * IE_Api::post() encodes once, into a variable, and both signs and sends that
 * same variable.
 *
 * Matches middleware/requireSite.js on the server, line for line.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Signing {

	/** How far apart the two clocks may be, in seconds. */
	const MAX_SKEW = 300;

	/**
	 * Build the string that gets signed.
	 *
	 * @param string $timestamp unix seconds, as a string
	 * @param string $method    HTTP method
	 * @param string $path      path only — never the query string
	 * @param string $body      the exact bytes of the request body
	 */
	public static function canonical( $timestamp, $method, $path, $body ) {
		return $timestamp . "\n"
			. strtoupper( $method ) . "\n"
			. $path . "\n"
			. hash( 'sha256', (string) $body );
	}

	public static function sign( $secret, $timestamp, $method, $path, $body ) {
		return hash_hmac(
			'sha256',
			self::canonical( $timestamp, $method, $path, $body ),
			(string) $secret
		);
	}

	/**
	 * Check a signature we were sent.
	 *
	 * Returns true or a WP_Error — never a bare false. A bare false gives the
	 * caller no way to tell "wrong signature" from "not connected", and those
	 * need completely different fixes.
	 */
	public static function verify( $secret, $signature, $timestamp, $method, $path, $body ) {
		if ( '' === (string) $secret ) {
			return new WP_Error(
				'ie_not_connected',
				'This site is not connected to an account.',
				array( 'status' => 403 )
			);
		}

		if ( ! $signature || ! $timestamp ) {
			return new WP_Error( 'ie_unsigned', 'Missing signature.', array( 'status' => 401 ) );
		}

		if ( ! ctype_digit( (string) $timestamp ) ) {
			return new WP_Error( 'ie_unsigned', 'Malformed timestamp.', array( 'status' => 401 ) );
		}

		if ( abs( time() - (int) $timestamp ) > self::MAX_SKEW ) {
			// Almost always a clock, not an attack. Worth its own message
			// because the fix is "fix your server's time", which nobody guesses
			// from "signature did not match".
			return new WP_Error(
				'ie_stale',
				'Signature timestamp is outside the accepted window. Check this server\'s clock.',
				array( 'status' => 401 )
			);
		}

		$expected = self::sign( $secret, (string) $timestamp, $method, $path, $body );

		// hash_equals, not ===. A plain comparison returns early on the first
		// differing byte, and that timing difference is enough to recover a
		// signature one byte at a time.
		if ( ! hash_equals( $expected, (string) $signature ) ) {
			return new WP_Error( 'ie_bad_signature', 'Signature did not match.', array( 'status' => 401 ) );
		}

		return true;
	}
}
