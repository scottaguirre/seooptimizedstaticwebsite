<?php
/**
 * The link swap.
 *
 * This is the only piece of the planner that had to be ported to PHP, because
 * it is the only piece that runs at publish time rather than at plan time.
 * Everything else — the ring, the anchor allocation, the slugs — is computed
 * once on the server and stored.
 *
 * WHY A MARKED SPAN AND NOT A LINK
 *
 * A post published in March cannot link to a post that will not exist until
 * June: for three months that is a 404. So the March post carries
 *
 *     <span data-il-link="topic-3">tankless water heaters</span>
 *
 * which reads as ordinary prose. When topic-3 publishes, activate() swaps it
 * for a real anchor.
 *
 * WHY THIS IS SAFE ON CONTENT THE OWNER HAS EDITED
 *
 * It only ever touches a span carrying that exact attribute. It does not parse
 * the post, does not rewrite paragraphs, and does not care what else is in
 * there. If the owner deleted the span, the swap finds nothing and says so —
 * which is the correct outcome, not an error.
 *
 * @package interlink-engine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class IE_Links {

	/**
	 * Turn every pending reference to $topic_id into a live link.
	 *
	 * @param string $content  post_content
	 * @param string $topic_id e.g. "topic-3"
	 * @param string $url      where it now points
	 * @return array{content:string,count:int}
	 */
	public static function activate( $content, $topic_id, $url ) {
		$id = preg_quote( $topic_id, '#' );

		// Any attributes before or after data-il-link are carried through, so
		// a class the owner added in the block editor survives the swap.
		$pattern = '#<span([^>]*?)\s+data-il-link="' . $id . '"([^>]*)>(.*?)</span>#is';

		$count   = 0;
		$href    = esc_url( $url );

		$out = preg_replace_callback(
			$pattern,
			function ( $m ) use ( $href, &$count ) {
				$count++;
				$rest = trim( $m[1] . $m[2] );
				return '<a href="' . $href . '"' . ( $rest ? ' ' . $rest : '' ) . '>' . $m[3] . '</a>';
			},
			$content
		);

		// preg_replace_callback returns null on failure (catastrophic
		// backtracking, bad encoding). Returning null here would blank the
		// post, so the original content wins.
		if ( null === $out ) {
			return array( 'content' => $content, 'count' => 0 );
		}

		return array( 'content' => $out, 'count' => $count );
	}

	/**
	 * Which topics is this post still waiting on?
	 */
	public static function pending_ids( $content ) {
		if ( ! preg_match_all( '#<span[^>]*\sdata-il-link="([^"]+)"[^>]*>#i', $content, $m ) ) {
			return array();
		}
		return array_values( array_unique( $m[1] ) );
	}

	/**
	 * Build post_content from the writer's sections, resolving the link tokens.
	 *
	 * The writer wraps each required anchor in {{money}}…{{/money}} and so on.
	 * Tokens are trivially findable, which is what lets us verify a post
	 * actually linked where it was told to rather than hoping it did.
	 *
	 * @param array $sections [{ heading, paragraphs[] }]
	 * @param array $targets  money|prev|next => array('url'=>…) or array('pending_id'=>…)
	 * @return array{content:string,missing:string[]}
	 */
	public static function render( $sections, $targets ) {
		$html = '';

		foreach ( (array) $sections as $section ) {
			if ( ! empty( $section['heading'] ) ) {
				$html .= '<h2>' . esc_html( $section['heading'] ) . "</h2>\n";
			}
			foreach ( (array) ( isset( $section['paragraphs'] ) ? $section['paragraphs'] : array() ) as $p ) {
				// esc_html first: the model's prose is untrusted text, and the
				// ONLY markup we want in it is the tokens we put there. The
				// tokens survive escaping because they contain no HTML.
				$html .= '<p>' . esc_html( $p ) . "</p>\n";
			}
			$html .= "\n";
		}

		$missing = array();

		foreach ( array( 'money', 'prev', 'next' ) as $name ) {
			$pattern = '#\{\{' . $name . '\}\}(.*?)\{\{/' . $name . '\}\}#s';
			$target  = isset( $targets[ $name ] ) ? $targets[ $name ] : null;
			$hit     = false;

			$html = preg_replace_callback(
				$pattern,
				function ( $m ) use ( $target, &$hit, &$html ) {
					$hit  = true;
					$text = $m[1];

					// The writer uses the phrase verbatim, as instructed, which
					// means it sometimes lands at the start of a sentence in
					// lower case. Telling the model not to do that is a rule it
					// forgets on post 40; fixing it here cannot be forgotten.
					$text = self::capitalise_if_sentence_start( $html, $m[0], $text );

					if ( null === $target ) {
						return $text;   // nothing to link to — unwrap
					}
					if ( ! empty( $target['pending_id'] ) ) {
						return '<span data-il-link="' . esc_attr( $target['pending_id'] ) . '">' . $text . '</span>';
					}
					return '<a href="' . esc_url( $target['url'] ) . '">' . $text . '</a>';
				},
				$html
			);

			if ( $target && ! $hit ) {
				$missing[] = $name;
			}
		}

		return array( 'content' => $html, 'missing' => $missing );
	}

	/**
	 * Upper-case the first letter when the token opens a sentence.
	 *
	 * Finds the token's position in the haystack and walks back over
	 * whitespace. A '>' counts as a sentence start because it means the token
	 * begins a paragraph.
	 */
	private static function capitalise_if_sentence_start( $haystack, $token, $text ) {
		$pos = strpos( $haystack, $token );
		if ( false === $pos ) {
			return $text;
		}

		for ( $i = $pos - 1; $i >= 0; $i-- ) {
			$c = $haystack[ $i ];
			if ( ctype_space( $c ) ) {
				continue;
			}
			if ( '.' === $c || '!' === $c || '?' === $c || '>' === $c ) {
				break;
			}
			return $text;   // mid-sentence, leave it alone
		}

		return preg_replace_callback(
			'/^(\s*)([a-z])/',
			function ( $m ) {
				return $m[1] . strtoupper( $m[2] );
			},
			$text
		);
	}
}
