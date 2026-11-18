// routes/logoPreviewRoute.js
//
// GET /logo-preview?name=...&shape=...&theme=...
//
// The wordmark the build will draw, drawn now, so the review step can show it
// before the customer pays.
//
// ---------------------------------------------------------------------------
// IT RUNS THE GENERATOR RATHER THAN IMITATING IT
// ---------------------------------------------------------------------------
// The obvious cheap version of this endpoint is a canvas in the browser with
// a web font. It would be faster and it would be WRONG in the one way a
// preview must never be wrong: the browser's font, its hinting, its line
// breaking and its idea of where the text sits vertically are all different
// from opentype.js and sharp. The customer would approve one picture and be
// sold another.
//
// So this calls utils/wordmarkLogo.js — the same function, the same font
// file, the same colour table, the same box from utils/logoSizes.js. What
// comes back from here is byte-for-byte what the site will ship, except for
// the header colour painted behind it.
//
// ---------------------------------------------------------------------------
// NOTHING IS WRITTEN AND NOTHING IS CHARGED
// ---------------------------------------------------------------------------
// The PNG is produced in memory and streamed. No credits, no job, no file in
// dist/, no row anywhere. A customer can step back and forth between this and
// the design tiles comparing all seven themes, which is the entire point.

const express = require('express');

const router = express.Router();

const { logoPreviewLimiter } = require('../middleware/rateLimits');
const { MAX_NAME_CHARS, sanitizeName, wordmarkSvg } = require('../utils/wordmarkLogo');
const { buildOptionsFor } = require('../utils/localOptions/designs');

const sharp = require('sharp');

router.get('/logo-preview', logoPreviewLimiter, async (req, res) => {
  const name = sanitizeName(String(req.query.name || '').slice(0, MAX_NAME_CHARS * 2));

  // 422 rather than 400, and a message rather than a picture: the review step
  // reaches this with an empty name whenever the customer jumped back before
  // filling in the business details, which is a normal thing to do and not an
  // error on their part.
  if (!name) {
    return res.status(422).json({ error: 'Enter the business name to see the logo.' });
  }

  /* LOCAL WEBSITE OPTIONS IS COLOURED BY ITS STRUCTURE, NOT BY A THEME.
   *
   * That mode hides the Design & Theme step, so the styleKey the wizard
   * still remembers belongs to no choice the customer made and the build
   * throws it away. What decides its header is the structure — ledger and
   * beacon on white, anvil on near-black.
   *
   * RESOLVED THROUGH designs.js, the same call runLocalOptions.js makes, so
   * the preview cannot pick a different structure from the build. That also
   * covers the "Choose for me" case, where the dropdown is empty and both
   * sides land on ledger for the same documented reason.
   *
   * Absent `design` leaves structure empty, which paletteFor() reads as
   * "another mode" and falls through to the theme table. */
  /* NO MODE PASSED, DELIBERATELY, and designs.js documents what omitting it
   * means: any mode. This route colours a preview and nothing is built from
   * its answer, so a design id from a mode this page does not belong to is a
   * wrong colour at worst. The build call in runLocalOptions.js passes the
   * mode, because that one decides what the customer gets.
   *
   * WHEN THE CLOUDFLARE WIZARD USES THIS PREVIEW it will want its own mode
   * passed in, and that is a query parameter to add then rather than a
   * default to guess now. */
  const structure = 'design' in req.query
    ? buildOptionsFor(req.query.design).structure
    : '';

  try {
    const svg = wordmarkSvg({
      businessName: name,
      logoType: req.query.shape,
      styleKey: req.query.theme,
      structure,
      withBackdrop: true,
    });

    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    // Private, because the business name is in the URL and this is one
    // customer's unsaved draft. A shared cache holding it would serve one
    // person's name to another at the same proxy.
    //
    // Cached at all because the review step re-renders on every visit and the
    // answer only changes when the name, the shape or the theme does — all
    // three of which are in the query string, so a changed answer has a
    // changed URL and the old entry is simply never asked for again.
    res.set('Cache-Control', 'private, max-age=300');
    res.type('png').send(png);
  } catch (err) {
    // A throw here is a bug in the generator, not a bad request: everything
    // the customer controls has already been validated or defaulted. Logged
    // loudly, answered quietly — the review step shows a note instead of a
    // broken image, and the Generate button is not blocked by a preview.
    console.error('logo-preview failed:', err);
    res.status(500).json({ error: 'The logo preview could not be drawn.' });
  }
});

module.exports = router;
