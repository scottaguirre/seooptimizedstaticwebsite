// utils/emailLayout.js
//
// The HTML half of a transactional email.
//
// Every message sent so far has been plain text. That works, but on a phone
// the reset link is a bare wrapped URL the recipient has to hit accurately
// with a thumb, and there is nothing on the page that says who sent it.
//
// This builds the HTML alternative. The plain text version stays exactly as
// it is — both go out together, and the client picks. That pairing is also
// the deliverability argument: an HTML-only message is more suspicious to a
// filter than one that carries both, because bulk senders routinely skip the
// text part. It is a small effect. It is not a reason to expect spam
// placement to change on its own.
//
// Constraints worth knowing before editing any of this, because email HTML is
// not web HTML:
//
//   * Layout is tables. Flexbox and grid are unsupported in Outlook, which
//     renders with Word's engine, not a browser's.
//   * CSS is inline. Gmail strips much of what is in <style>, and strips it
//     inconsistently between the web client and the mobile apps.
//   * No external images. Most clients block remote images by default, so
//     anything load-bearing must survive not loading. The wordmark here is
//     text for that reason.
//   * Padding goes on <td>, never on <a>. Word ignores padding on inline
//     elements, which silently collapses a button to bare text in Outlook.

// Matches the app's own pages: src/views/login.html sets this background.
const NAVY = '#082d5b';
const INK = '#1c2530';
const MUTED = '#5b6875';
const PAGE_BG = '#f4f6f8';
const CARD_BG = '#ffffff';
const HAIRLINE = '#e3e8ee';

// Georgia and friends are avoided: a system sans stack renders the same in
// every client without a webfont, and webfonts are blocked as often as
// images.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Escape for HTML text and for quoted attribute values.
 *
 * The URLs here are built from BASE_URL and a hex token, so there is nothing
 * dangerous in them today. That is a fact about the current callers, not a
 * property of the function, and the next caller may pass something else.
 */
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Refuse anything that is not an ordinary web link.
 *
 * A button is the one place in the message a recipient is being asked to
 * click, so an href of `javascript:` or `data:` reaching one would be worth
 * more to an attacker than anywhere else on the page. Rather than sanitise a
 * bad scheme into something plausible, this returns '#', which visibly does
 * nothing — a dead button gets reported; a quietly rewritten one does not.
 */
function safeUrl(url) {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) ? value : '#';
}

function paragraph(text, { muted = false, small = false } = {}) {
  const size = small ? '14px' : '16px';
  const color = muted ? MUTED : INK;
  return `
                <p style="margin:0 0 16px 0; font-family:${FONT}; font-size:${size}; line-height:1.6; color:${color};">${text}</p>`;
}

/**
 * @param {object} opts
 * @param {string} opts.heading      the <h1> inside the card
 * @param {string} opts.preheader    the grey snippet shown after the subject
 *                                   in an inbox list; keep it under ~90 chars
 * @param {string} opts.intro        one sentence above the button
 * @param {string} opts.buttonLabel  text on the button
 * @param {string} opts.url          where the button goes
 * @param {string[]} [opts.after]    paragraphs below the fallback link
 * @returns {string} a complete HTML document
 */
function emailLayout({ heading, preheader, intro, buttonLabel, url, after = [] }) {
  const href = escapeHtml(safeUrl(url));
  const year = new Date().getFullYear();

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- Without these, Gmail on Android inverts the card to dark grey and the
       navy button loses most of its contrast. -->
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0; padding:0; background-color:${PAGE_BG};">

  <!-- The inbox preview snippet. Hidden in the body, shown in the list.
       The run of zero-width spaces after it stops the client pulling the
       first line of real copy in behind it. -->
  <div style="display:none; font-size:1px; color:${PAGE_BG}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${escapeHtml(preheader)}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- 600px is the long-standing safe width: wider than this and
             Outlook's reading pane crops rather than scales. -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">

          <tr>
            <td align="left" style="padding:0 8px 16px 8px; font-family:${FONT}; font-size:15px; font-weight:600; letter-spacing:0.2px; color:${NAVY};">
              Fast Website Generator
            </td>
          </tr>

          <tr>
            <td style="background-color:${CARD_BG}; border:1px solid ${HAIRLINE}; border-radius:8px; padding:32px;">

              <h1 style="margin:0 0 16px 0; font-family:${FONT}; font-size:22px; line-height:1.3; font-weight:600; color:${INK};">${escapeHtml(heading)}</h1>
${paragraph(escapeHtml(intro))}

              <!-- Button. The background and the padding are both on the td:
                   Word ignores padding on the <a>, so putting it there gives
                   Outlook a coloured strip with unpadded text inside it. The
                   cost of doing it this way is that only the text is
                   clickable, not the whole cell. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
                <tr>
                  <td align="center" bgcolor="${NAVY}" style="border-radius:6px; padding:14px 28px;">
                    <a href="${href}" style="font-family:${FONT}; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none; display:inline-block;">${escapeHtml(buttonLabel)}</a>
                  </td>
                </tr>
              </table>

              <!-- The same link as text. A blocked or stripped button leaves
                   the recipient with no way through otherwise, and some
                   people would rather see where a link goes before taking
                   it. break-all because a token-length URL overflows a phone
                   otherwise. -->
${paragraph('If the button does not work, copy this link into your browser:', { muted: true, small: true })}
              <p style="margin:0 0 24px 0; font-family:${FONT}; font-size:13px; line-height:1.5; color:${MUTED}; word-break:break-all;"><a href="${href}" style="color:${NAVY};">${href}</a></p>

              <div style="border-top:1px solid ${HAIRLINE}; padding-top:20px;">
${after.map(text => paragraph(escapeHtml(text), { muted: true, small: true })).join('')}
              </div>

            </td>
          </tr>

          <tr>
            <td align="left" style="padding:20px 8px 0 8px; font-family:${FONT}; font-size:12px; line-height:1.5; color:${MUTED};">
              &copy; ${year} Fast Website Generator. This is an automated message about your account.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

module.exports = { emailLayout, escapeHtml, safeUrl };
