// utils/wordmarkLogo.js
//
// Draws a logo from the business name, for customers who have no logo file.
//
// ---------------------------------------------------------------------------
// WHY GLYPHS BECOME PATHS INSTEAD OF <text>
// ---------------------------------------------------------------------------
// sharp rasterises SVG through librsvg, and librsvg resolves <text> against
// the FONTS INSTALLED ON THE MACHINE. The VPS has none. An SVG that says
//
//     <text font-family="Inter">Round Rock Plumbing</text>
//
// renders locally on a Mac — which has Inter, or silently substitutes
// something — and ships a BLANK LOGO from the server. No error, no warning,
// a successful build, an empty header, and a customer who has paid.
//
// opentype.js converts each glyph to a <path>. A path is geometry: it needs
// no font at render time, so what the Mac draws and what the server draws are
// the same picture. The font file is read at build time and never consulted
// again.
//
// A SECOND PROPERTY FALLS OUT OF THAT, and it is worth stating because it is
// the reason this file escapes nothing: the business name never reaches the
// markup. It is turned into coordinates before the SVG string exists, so
// there is no text node for a quote or an angle bracket to break out of.
//
// ---------------------------------------------------------------------------
// WHY PER-GLYPH LAYOUT INSTEAD OF font.getPath()
// ---------------------------------------------------------------------------
// opentype.js's own getPath() applies the font's GSUB substitutions, and on
// Inter it throws:
//
//     substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported
//
// charToGlyph() per character, advanced by advanceWidth and kerned with
// getKerningValue(), skips the substitution table entirely. Ligatures and
// contextual alternates are lost. For a business name set in a bold sans that
// is invisible; a crash is not.

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const sharp = require('sharp');

const { logoSize } = require('./logoSizes');
const { markKeyFor, markGroup } = require('./localOptions/tradeMarks');

// ---------------------------------------------------------------------------
// COLOUR
// ---------------------------------------------------------------------------
/**
 * What colour the wordmark has to be, per theme, and what it is sitting on.
 *
 * THERE IS NO SINGLE SAFE COLOUR. The seven themes put the logo on seven
 * different backgrounds, and the stylesheets expose no variable to read:
 *
 *   style    #headerColor background-color: #082d5b          dark navy
 *   style2   #headerColor background-color: #d8d7d7          light grey
 *   style3   #headerColor background: black                  black
 *   style4   #headerColor has no background                  the white page
 *   style5   #headerColor has no background                  the white page
 *   style6   #headerColor hsla(207,45%,13%,1)                dark blue
 *   style7   #headerColor transparent, position absolute     the hero photo
 *   style8   #headerColor background-color #fff             white
 *
 * White text on style2, style4, style5 or style8 is an invisible logo. Dark
 * text on style, style3, style6 or style7 is an invisible logo. This table is the
 * only thing standing between a paying customer and a header that looks like
 * the image failed to load.
 *
 * ⚠️ A THEME ADDED TO THE WIZARD MUST BE ADDED HERE TOO. This is the same
 * trap HERO_LAYOUT in utils/stripUnusedHero.js documents, and it fails the
 * same quiet way: an unknown key takes the fallback below, which is right for
 * roughly half the themes and catastrophic for the other half.
 * test-wordmark-logo.js compares this list against THEMES in the wizard.
 *
 *   ink       the colour of the letters
 *   tile      the favicon's background square — always dark enough to read as
 *             a shape against both light and dark browser chrome
 *   halo      true when the background is a PHOTOGRAPH rather than a colour,
 *             so the letters need a shadow to survive a bright patch of sky
 *   backdrop  the header colour this wordmark will actually sit on. USED ONLY
 *             BY THE PREVIEW, which paints it behind the letters — a white
 *             wordmark previewed on a white card is a blank rectangle, and a
 *             customer would reasonably conclude the feature is broken.
 */
const THEME_INK = {
  style:  { ink: '#ffffff', tile: '#082d5b', halo: false, backdrop: '#082d5b' },
  style2: { ink: '#111111', tile: '#333333', halo: false, backdrop: '#d8d7d7' },
  style3: { ink: '#ffffff', tile: '#000000', halo: false, backdrop: '#000000' },
  style4: { ink: '#111111', tile: '#111111', halo: false, backdrop: '#ffffff' },
  /* WAS DARK INK ON WHITE, which was right for the design that used to be
   * in style5.css. That file is now a copy of style9.css and its header
   * is blue, so #111111 on #013cae would have been about 1.4:1 — a logo
   * you cannot see, on every Design 5 site, with nothing reporting it. */
  style5: { ink: '#ffffff', tile: '#013cae', halo: false, backdrop: '#013cae' },
  style6: { ink: '#ffffff', tile: '#122330', halo: false, backdrop: '#122330' },
  // style7's header is transparent over the hero photograph, so there is no
  // colour to show. A mid blue-grey stands in for an average photograph: dark
  // enough that white reads, light enough that the halo is visibly doing
  // something rather than looking like a mistake.
  style7: { ink: '#ffffff', tile: '#111111', halo: true,  backdrop: '#6b8fb5' },
  // style8 began as a copy of style7 and takes the OPPOSITE ink, which is the
  // whole reason it is a separate design: its #headerColor is background-color
  // #fff in normal flow, not transparent and floating.
  //
  // NEITHER VALUE IS A CHOICE MADE HERE. #0a1f52 is --navy in
  // src/css/themes/style8.css, the colour the nav links beside the logo are
  // drawn in; repalette that file and this line has to follow it or the
  // wordmark is a near-match, which looks like a mistake rather than a
  // decision. The tile is the brand, #053389, because a favicon is a shape in
  // browser chrome and should be the colour people recognise.
  style8: { ink: '#0a1f52', tile: '#053389', halo: false, backdrop: '#ffffff' },
  // style9's header is a solid #013CAE bar, so the wordmark is WHITE on it —
  // the opposite of style8, whose header is white. The tile is the same blue,
  // which is the colour a customer would recognise in browser chrome.
  style9: { ink: '#ffffff', tile: '#013cae', halo: false, backdrop: '#013cae' },
};

/**
 * Dark ink, because the fallback has to be the one that survives being wrong
 * in the place it is most likely to be wrong.
 *
 * An unknown styleKey reaching here means a theme was added to the wizard and
 * not to the table above. The generated site then renders with whatever CSS
 * resolveThemeCss found — and a brand new theme is far more likely to have a
 * white or light header (four of the seven do, and both of the most recent
 * additions started that way) than a near-black one. Dark ink on a dark
 * header is a logo you can still faintly see; white ink on white is nothing
 * at all.
 */
const INK_FALLBACK = { ink: '#111111', tile: '#111111', halo: false, backdrop: '#ffffff' };

function inkFor(styleKey) {
  const key = String(styleKey == null ? '' : styleKey).trim();
  return THEME_INK[key] || INK_FALLBACK;
}

/**
 * The same table again, for Local Website Options.
 *
 * A SECOND TABLE RATHER THAN MORE ROWS IN THE FIRST, because these are not
 * themes and they are not keyed the same way. That mode does not have a
 * styleKey at all — its Design step is hidden, and whichever of style1 to
 * style7 the wizard remembers is thrown away by runLocalOptions.js. What it
 * has instead is a STRUCTURE, resolved from the Design dropdown by
 * utils/localOptions/designs.js, and no two of them look alike.
 *
 * Merging the two would mean one lookup where 'style3' and 'anvil' are
 * neighbours and nothing says which namespace a key belongs to. The first
 * collision would be silent.
 *
 * Read from utils/localOptions/render/theme.js, where each structure
 * declares its own custom properties:
 *
 *   ledger   .ledger-head      background --lg-card  #fff      white
 *   beacon   .beacon-masthead  background --bn-card  #fff      white
 *   anvil    .anvil-brand__plate          #fff                 white
 *   quarry   .quarry-bar       background --qy-raise #f6f5f1   off-white
 *   harbor   .harbor-mark__img background #fff                white
 *
 * ⚠️ ANVIL'S RAIL IS NEAR-BLACK AND THAT IS NOT WHAT THE LOGO SITS ON.
 * This table first read .anvil-rail (--av-raise, #1a212b) and gave the
 * wordmark near-white ink, which shipped as pale letters on a white card.
 * The logo is wrapped in .anvil-brand__plate, and theme.js says why:
 *
 *     THE LIGHT PLATE IS THE DARK-PAGE TAX ON LOGOS. A wordmark drawn in
 *     dark ink on transparency is invisible on this rail, and no rule here
 *     can look inside the file to find out whether this one is.
 *
 * That is right for an UPLOAD, whose colours nothing can know. It is the
 * wrong question for a wordmark, which this file draws and therefore knows
 * exactly. So the ink matches the plate, not the rail behind it.
 *
 *     THE BACKDROP IS THE SURFACE THE LETTERS LAND ON, NOT THE SECTION
 *     AROUND IT. One element too far out is an invisible logo.
 *
 * test-wordmark-logo.js reads that plate rule back out of theme.js, so if
 * the plate is ever removed this table is told rather than left behind.
 *
 * ⚠️ A STRUCTURE ADDED TO structures.js MUST BE ADDED HERE TOO — the same
 * trap as THEME_INK above and HERO_LAYOUT in utils/stripUnusedHero.js, and
 * it fails the same quiet way. test-wordmark-logo.js compares this list
 * against the registry.
 */
const STRUCTURE_INK = {
  ledger: { ink: '#1b1a18', tile: '#0f5c5c', halo: false, backdrop: '#ffffff' },
  beacon: { ink: '#111822', tile: '#1e3a5f', halo: false, backdrop: '#ffffff' },
  /* Anvil's own rail colour, used as INK here because the plate behind the
   * letters is white. It ties the logo to the design rather than being a
   * neutral black that belongs to no part of it. */
  anvil:  { ink: '#1a212b', tile: '#1a212b', halo: false, backdrop: '#ffffff' },

  /* QUARRY HAS NO PLATE, so the backdrop is the bar itself — --qy-raise,
   * #f6f5f1 — and not the white Anvil's letters land on. The whole reason
   * Anvil's row needed its warning is that the two are different elements;
   * reading this one as #ffffff would be the same mistake with the error
   * running the other way, and far quieter: near-white letters on a white
   * card are obviously wrong, and ink mixed for white sitting on #f6f5f1 is
   * merely slightly off.
   *
   * THE TILE IS QUARRY'S MOSS, --qy-accent, which is what .quarry-dial and
   * .quarry-brand__glyph are filled with. */
  quarry: { ink: '#1c1e1a', tile: '#3f5231', halo: false, backdrop: '#f6f5f1' },

  /* HARBOR PUTS THE LOGO ON A WHITE PLATE OVER A NAVY RAIL, which is
   * Anvil's situation and Anvil's answer: the rail is dark, so a wordmark
   * drawn in dark ink on transparency would vanish on it. The ink is the
   * rail's own navy, so the mark belongs to the design rather than being a
   * neutral black. The tile is the brass the call button is filled with. */
  harbor: { ink: '#15202b', tile: '#8a5f18', halo: false, backdrop: '#ffffff' },

  /* ATLAS HAS NO PLATE AND NO BAR COLOUR, so the backdrop is the page —
   * --at-page, #faf8f3 — which is Quarry's situation read one shade warmer.
   * The bar on this structure has no background of its own at all: it is
   * two lines of type and a double rule, sitting directly on the page.
   *
   *     READING THIS ONE AS #ffffff IS THE QUIET VERSION OF ANVIL'S
   *     MISTAKE. Ink mixed for white on a warm off-white is not obviously
   *     wrong, it is merely slightly dirty, which is the kind of thing
   *     nobody reports and everybody notices.
   *
   * THE TILE IS ATLAS'S OWN ACCENT, --at-mark, which is what the phone
   * number is underlined in and what the numerals in the margin are set
   * in. */
  atlas:  { ink: '#23201c', tile: '#8a6a2f', halo: false, backdrop: '#faf8f3' },

  /* ORCHARD'S BAR IS WHITE AND THE PAGE BEHIND IT IS NOT, which is a third
   * answer again. Anvil and Harbor draw on a dark rail, Quarry and Atlas on
   * the page itself; this one has a white bar sitting on a warm cream page,
   * so the backdrop is --oc-card and not --oc-page.
   *
   *     THE BACKDROP IS WHATEVER THE LOGO ACTUALLY SITS ON,
   *     WHICH IS NOT ALWAYS THE PAGE AND NOT ALWAYS THE RAIL.
   *
   * Reading it as the page colour would mix the ink against #fbfaf6 and
   * then paint it on #ffffff — the same class of mistake as Quarry's, one
   * shade smaller and just as invisible.
   *
   * THE TILE IS ORCHARD'S LEAF GREEN, --oc-leaf, which the call button and
   * the Send button are both filled with. */
  orchard: { ink: '#20291f', tile: '#3d6b3a', halo: false, backdrop: '#ffffff' },
};

/**
 * Which table to read, and the argument that decides it.
 *
 * `structure` wins when it is given at all, because only one mode supplies
 * it and that mode has no meaningful styleKey to fall back to. An EMPTY
 * structure is not a choice, it is the other three modes, so it falls
 * through to the theme table rather than to the fallback.
 */
function paletteFor({ styleKey, structure } = {}) {
  const key = String(structure == null ? '' : structure).trim();
  if (!key) return inkFor(styleKey);

  return STRUCTURE_INK[key] || INK_FALLBACK;
}

// ---------------------------------------------------------------------------
// FONT
// ---------------------------------------------------------------------------
/**
 * Inter Bold, from @fontsource/inter.
 *
 * A DEPENDENCY RATHER THAN A FILE COMMITTED TO THE REPOSITORY. Two reasons,
 * and the second is the one that matters:
 *
 *   - npm install on the server fetches it, so deploy.sh and .rsync-exclude
 *     never have to learn about binary assets.
 *   - the package carries its own LICENSE (SIL Open Font License), which is
 *     what makes redistributing the glyphs lawful. A .ttf dropped into src/
 *     arrives with no licence next to it and nothing recording where it came
 *     from.
 *
 * The LATIN subset covers U+0000–U+00FF, so every accented character a US or
 * Latin American business name uses — á é í ó ú ñ ü — is present. A character
 * outside it maps to .notdef, which draws as an empty box; see sanitizeName.
 */
const FONT_FILE = '@fontsource/inter/files/inter-latin-700-normal.woff';

let cachedFont = null;

function loadFont() {
  if (cachedFont) return cachedFont;

  const file = require.resolve(FONT_FILE);
  const buf = fs.readFileSync(file);

  // .buffer alone is wrong: Buffer instances are views into a SHARED pool, so
  // buf.buffer is usually a 8 KB slab holding several unrelated allocations
  // and opentype reads whatever happens to sit at offset 0. The subarray is
  // the bytes of THIS file.
  cachedFont = opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );

  return cachedFont;
}

/** For tests: forget the parsed font so a stub can take its place. */
function _resetFontCache() {
  cachedFont = null;
}

// ---------------------------------------------------------------------------
// TEXT
// ---------------------------------------------------------------------------
const MAX_NAME_CHARS = 60;

/**
 * The name, reduced to what the latin subset can actually draw.
 *
 * Anything outside U+0020–U+00FF is dropped rather than rendered, because
 * .notdef draws as a hollow rectangle and a logo reading "Caf□ Luna" is worse
 * than one reading "Caf Luna". Dropping is also what the rest of the pipeline
 * does with characters it cannot handle, so the logo matches the page.
 */
function sanitizeName(businessName) {
  const raw = String(businessName == null ? '' : businessName);

  // COLLAPSE BEFORE STRIPPING, and the order is the whole point. A tab and a
  // newline are both outside the latin range, so stripping first DELETED
  // them and glued the words either side together: a name pasted out of a
  // spreadsheet came through as "AcmePlumbing". Turning every run of
  // whitespace into one space first means the separator survives as a space
  // and only the unprintable characters are lost.
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[^\u0020-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

/**
 * Words that say what kind of company it is rather than which company it is.
 * Dropped from the FAVICON only — two letters have room for the name and not
 * for its legal suffix. The wordmark itself keeps every word.
 */
const FILLER = new Set([
  'the', 'and', 'of', 'a', 'an', '&',
  'co', 'co.', 'company', 'llc', 'l.l.c.', 'inc', 'inc.', 'ltd', 'ltd.',
  'corp', 'corp.', 'corporation', 'group', 'services', 'service',
]);

/**
 * One or two letters for the favicon.
 *
 * Falls back through: two significant words -> the first two letters of the
 * only significant word -> the first two letters of the raw name. The last
 * step matters because a business legitimately named "The Company" has no
 * significant words at all and still needs a favicon.
 */
function initialsFor(businessName) {
  const name = sanitizeName(businessName);
  if (!name) return '';

  const words = name.split(' ').filter(Boolean);
  const significant = words.filter(w => !FILLER.has(w.toLowerCase()));

  if (significant.length >= 2) {
    return (significant[0][0] + significant[1][0]).toUpperCase();
  }
  if (significant.length === 1) {
    return significant[0].slice(0, 2).toUpperCase();
  }
  return name.replace(/\s/g, '').slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// LAYOUT
// ---------------------------------------------------------------------------
const REF_SIZE = 100;      // widths are measured once at this size and scaled
const LINE_HEIGHT = 1.18;  // multiple of the font size

// Breathing room inside the box, as a fraction of each side. Every theme caps
// the logo's rendered height in CSS, so a wordmark drawn edge to edge would
// sit flush against whatever the header puts next to it.
const PAD_X = 0.05;
const PAD_Y = 0.08;

/**
 * Drawing is done at twice the published size and the <img> is told the
 * smaller number, so the logo stays sharp on the phone screens most of these
 * sites are read on.
 */
const SCALE = 2;

/**
 * The advance width of a string at REF_SIZE, and the glyphs that produced it.
 *
 * NO KERNING, AND THAT IS A MEASURED DECISION RATHER THAN AN OVERSIGHT.
 * An earlier version called font.getKerningValue() between each pair, with a
 * comment about "AV" and "To" sitting too far apart. It returned 0 for every
 * pair tried — 'AV', 'To', 'Ta', 'AW', 'Yo', 'P.', 'LT', 'W.', 'F,' — both
 * before and after font.position.init().
 *
 * The reason: this font has no legacy `kern` table at all (tables.kern is
 * false), only GPOS, and opentype.js does not surface Inter's GPOS pair
 * adjustments through that call. Inter also fits its sidebearings tightly
 * enough that it leans on them rather than on kern pairs.
 *
 * So the call could not affect a single pixel, and no test could tell
 * whether it was there. It was removed rather than left in looking like
 * care. If the font is ever swapped for one with a kern table, this is the
 * function to put it back in — and a test that asserts a nonzero adjustment
 * for a known pair is what should go back with it.
 */
function measure(font, text) {
  const scale = REF_SIZE / font.unitsPerEm;
  const glyphs = Array.from(text).map(ch => font.charToGlyph(ch));

  let width = 0;
  glyphs.forEach(glyph => { width += glyph.advanceWidth * scale; });

  return { width, glyphs };
}

/**
 * Every way of breaking the name into at most `maxLines` lines, as word runs.
 *
 * Only balanced splits are offered: for two lines that is every break point,
 * for three it is every pair. The caller picks whichever CANDIDATE RENDERS
 * LARGEST rather than whichever looks tidiest on paper, because the whole
 * point of wrapping is that a long name should not shrink to nothing.
 *
 * "Round Rock Plumbing Company" in the 250x100 wide box fits on one line at
 * roughly 26px, or on two at roughly 44px. The two-line version is the one a
 * person can read from a phone.
 */
function lineCandidates(words, maxLines) {
  const out = [[words.join(' ')]];
  if (words.length < 2 || maxLines < 2) return out;

  for (let i = 1; i < words.length; i += 1) {
    out.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  }

  if (maxLines >= 3 && words.length >= 3) {
    for (let i = 1; i < words.length - 1; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        out.push([
          words.slice(0, i).join(' '),
          words.slice(i, j).join(' '),
          words.slice(j).join(' '),
        ]);
      }
    }
  }

  return out;
}

/**
 * The largest font size at which `lines` fit inside the inner box.
 *
 * Bound by width (the longest line) and by height (the stack of them). No
 * search: both are linear in the font size, so each gives a size directly and
 * the smaller wins.
 */
function fitSize(font, lines, innerWidth, innerHeight) {
  const widest = Math.max(...lines.map(line => measure(font, line).width));

  const byWidth = widest > 0 ? (innerWidth * REF_SIZE) / widest : innerHeight;
  const byHeight = innerHeight / (lines.length * LINE_HEIGHT);

  return Math.min(byWidth, byHeight);
}

/**
 * How the name should be broken up, and how big it can be set.
 *
 * A square box gets three lines because it has the vertical room; the two
 * letterbox shapes get two, since a third line in 100px of height leaves each
 * one too small to read.
 */
function planLines(font, name, box) {
  const innerWidth = box.width * (1 - 2 * PAD_X);
  const innerHeight = box.height * (1 - 2 * PAD_Y);

  const maxLines = box.width / box.height < 1.4 ? 3 : 2;
  const words = name.split(' ').filter(Boolean);

  let best = null;
  for (const lines of lineCandidates(words, maxLines)) {
    const size = fitSize(font, lines, innerWidth, innerHeight);
    if (!best || size > best.size) best = { lines, size };
  }

  return best;
}

// ---------------------------------------------------------------------------
// DRAWING
// ---------------------------------------------------------------------------
/**
 * One line, laid out from x = 0 at baseline y = 0.
 *
 * Returns the path data, the advance width, and the INK BOUNDING BOX — the
 * rectangle the letters actually fill. The caller centres on that rather
 * than on font metrics, which is the difference between a logo that looks
 * centred and one that is merely inside its box.
 */
function linePath(font, line, size) {
  const scale = size / font.unitsPerEm;
  const { glyphs } = measure(font, line);

  const combined = new opentype.Path();
  let x = 0;

  glyphs.forEach(glyph => {
    combined.extend(glyph.getPath(x, 0, size));
    x += glyph.advanceWidth * scale;
  });

  // A line of nothing but spaces has no commands, and getBoundingBox() then
  // reports Infinities that poison every comparison downstream.
  const raw = combined.getBoundingBox();
  const bbox = Number.isFinite(raw.y1) && Number.isFinite(raw.y2)
    ? raw
    : { x1: 0, y1: 0, x2: x, y2: 0 };

  return { d: combined.toPathData(2), width: x, bbox };
}

/**
 * The wordmark as an SVG string.
 *
 * Pure: no filesystem, no sharp, no clock. The tests assert on this rather
 * than on a PNG, because a PNG tells you only that something was drawn.
 */
/**
 * How much of the box the trade mark takes, and where.
 *
 * TWO ARRANGEMENTS, NOT ONE — Edwin, 18 November, choosing between them:
 * beside the name on the wide shape, above it on the other two. A 250x100
 * box has room for a mark and a line of type side by side; a 120x120 box
 * does not, and a name squeezed into the 60px left over wraps a two-word
 * business onto three lines.
 *
 *     THE SHAPE DECIDES THE ARRANGEMENT. It is the only thing that knows
 *     how much room there is.
 *
 * The numbers are fractions of the box rather than pixels, so they hold at
 * SCALE 1 and SCALE 2 and at any size added later.
 */
const MARK_LAYOUT = {
  /* ⚠ THE MARK WAS 0.78 OF THE HEIGHT AND IT COST THE NAME A LINE. On the
   * 250x100 box that left the letters 279 of 500 units, and "Hill Country
   * Roofing" came out on THREE lines in small type beside a large wrench.
   *
   *     THE NAME IS THE LOGO. The mark is the adjective. Whatever is left
   *     after the mark has had its share is what the business is called,
   *     and that is the wrong way round to allocate the box.
   *
   * At 0.66, with the gaps tightened, the letters get 313 units and the
   * same name sets on two. */
  beside: { mark: 0.66, gap: 0.04, pad: 0.035 },  // of the box HEIGHT / WIDTH
  above: { mark: 0.46, gap: 0.05, pad: 0.06 },    // of the box HEIGHT
};

/**
 * Where the mark goes and what is left for the letters.
 *
 * RETURNS null WHEN THERE IS NO MARK, and every caller treats that as "draw
 * the wordmark exactly as it was drawn before". A trade with no mark, a
 * build that passes no trade at all, and a typo in the trade name all land
 * here — and all three must produce the logo this function has always
 * produced rather than a gap where a mark would have been.
 */
function markPlacement({ box, logoType, trade }) {
  const key = markKeyFor(trade);

  if (!key) return null;

  if ('wide' === String(logoType || '').trim().toLowerCase()) {
    const L = MARK_LAYOUT.beside;
    const side = box.height * L.mark;
    const pad = box.width * L.pad;
    const gap = box.width * L.gap;

    return {
      key,
      mark: { x: pad, y: (box.height - side) / 2, size: side },
      text: { width: box.width - pad * 2 - side - gap, height: box.height },
      offset: { x: pad + side + gap, y: 0 },
    };
  }

  const L = MARK_LAYOUT.above;
  const side = box.height * L.mark;
  const pad = box.height * L.pad;
  const gap = box.height * L.gap;

  return {
    key,
    mark: { x: (box.width - side) / 2, y: pad, size: side },
    text: { width: box.width, height: box.height - pad - side - gap },
    offset: { x: 0, y: pad + side + gap },
  };
}

function wordmarkSvg({ businessName, logoType, styleKey, structure, trade = '',
                       font = loadFont(), withBackdrop = false }) {
  const name = sanitizeName(businessName);
  if (!name) {
    throw new Error(
      'A wordmark needs a business name. Enter the name on the business ' +
      'details step, or upload a logo instead.'
    );
  }

  const base = logoSize(logoType);
  const box = { width: base.width * SCALE, height: base.height * SCALE };

  /* THE LETTERS ARE FITTED TO WHAT IS LEFT, not to the whole box. Laying
   * them out first and then putting a mark beside them is how a logo ends
   * up with the name running under its own symbol. */
  const placed = markPlacement({ box, logoType, trade });
  const textBox = placed ? placed.text : box;

  const { lines, size } = planLines(font, name, textBox);
  const colours = paletteFor({ styleKey, structure });

  const drawn = lines.map(line => linePath(font, line, size));

  // Vertical placement from the drawn bounding box rather than from the
  // font's ascender. A wordmark is a handful of letters, not a paragraph:
  // "Acme" has no descender and "Paging" does, and centring on metrics that
  // reserve room for both leaves a name with neither sitting visibly high.
  // CENTRED ON THE INK, NOT ON THE METRICS.
  //
  // This has been wrong twice. First it used the top of the block as if it
  // were a baseline, and clipped the first line off the top edge. Then it
  // used cap height and baseline, which is right until a line ends in a
  // descender: "Round Rock / Plumbing" has a 'g' hanging below the last
  // baseline, so the block measured 32px of air above and 16px below.
  //
  // The only measurement that cannot be wrong about which pixels are filled
  // is the bounding box of the pixels. Lay every line out at a provisional
  // baseline, union the boxes, then shift the lot so that union is centred.
  const leading = size * LINE_HEIGHT;

  let inkTop = Infinity;
  let inkBottom = -Infinity;

  drawn.forEach((line, i) => {
    inkTop = Math.min(inkTop, line.bbox.y1 + i * leading);
    inkBottom = Math.max(inkBottom, line.bbox.y2 + i * leading);
  });

  const firstBaseline = (textBox.height - (inkBottom - inkTop)) / 2 - inkTop;

  const letters = drawn.map((line, i) => {
    const x = (textBox.width - line.width) / 2;
    const y = firstBaseline + i * leading;
    return `<path transform="translate(${x.toFixed(2)} ${y.toFixed(2)})" d="${line.d}"/>`;
  }).join('');

  /* THE MARK IS PART OF `body`, WHICH IS WHAT THE HALO COPIES. On style7 the
   * header is a photograph and the halo is the only thing keeping white ink
   * off a bright sky — a mark left out of it would be the one piece of the
   * logo that disappears over clouds. */
  const text = placed
    ? `<g transform="translate(${placed.offset.x.toFixed(2)} ${placed.offset.y.toFixed(2)})">${letters}</g>`
    : letters;

  const body = (placed ? markGroup(placed.key, placed.mark) : '') + text;

  // On style7 the header is transparent over a photograph, so white letters
  // can land on a bright sky. The same glyphs are drawn once in black at a
  // small offset underneath. A drop-shadow filter would be tidier and is not
  // worth the risk: filter support is the part of SVG librsvg is most likely
  // to render differently from the browser the preview is checked in.
  const halo = colours.halo
    ? `<g fill="#000000" opacity="0.38" transform="translate(0 ${(size * 0.045).toFixed(2)})">${body}</g>`
    : '';

  // THE SITE'S LOGO IS TRANSPARENT. Only the preview paints the header
  // colour behind it, and it does so to show the customer the thing they are
  // actually approving: white letters on the navy their chosen theme uses,
  // not white letters on a white card.
  const backdrop = withBackdrop
    ? `<rect width="${box.width}" height="${box.height}" fill="${colours.backdrop}"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" ` +
    `viewBox="0 0 ${box.width} ${box.height}">` +
    backdrop +
    halo +
    `<g fill="${colours.ink}">${body}</g>` +
    '</svg>'
  );
}

/**
 * The favicon as an SVG string: the trade's mark, or the business's
 * initials, reversed out of a rounded tile.
 *
 * NOT THE WORDMARK SHRUNK. The upload path makes the favicon by resizing the
 * logo to 42x42, which is right for a logo and wrong for a line of text — a
 * 250px-wide wordmark squeezed into 42px is an illegible grey smear. Two
 * letters at 42px are two letters, and a single flat symbol is better than
 * either.
 *
 * ⚠ THE MARK WINS WHERE THERE IS ONE — 18 November, Edwin: *"fix the
 * favicon"*, on being told the logo would carry a wrench and the browser tab
 * would carry "AD". Two different marks for one business, eighteen pixels
 * apart, is the kind of thing nobody reports and everybody notices.
 *
 * INITIALS REMAIN THE FALLBACK, and they are not a legacy path: a trade with
 * no mark drawn yet, a build that passes no trade, and a typo in the trade
 * name all land there, and all three have to produce the favicon this
 * function has always produced.
 *
 * THE MARK IS DRAWN BIGGER THAN THE LETTERS WERE — 0.74 of the tile against
 * 0.62. Two capitals need air around them to read as letters; a single
 * silhouette does not, and at 42px it needs every pixel it can have.
 *
 * The tile is always dark, so the favicon reads as a shape against a light
 * browser tab and against a dark one. White on it, whatever the theme's ink
 * is, for the same reason.
 */
function faviconSvg({ businessName, styleKey, structure, trade = '',
                      font = loadFont(), size = 42 }) {
  const colours = paletteFor({ styleKey, structure });
  const px = size * SCALE;
  const tile = `<rect width="${px}" height="${px}" rx="${(px * 0.2).toFixed(2)}" `
    + `fill="${colours.tile}"/>`;

  const key = markKeyFor(trade);

  if (key) {
    const side = px * 0.74;

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `
      + `viewBox="0 0 ${px} ${px}">`
      + tile
      + `<g fill="#ffffff">`
      + markGroup(key, { x: (px - side) / 2, y: (px - side) / 2, size: side })
      + '</g></svg>'
    );
  }

  const initials = initialsFor(businessName);
  if (!initials) {
    throw new Error(
      'A wordmark needs a business name. Enter the name on the business ' +
      'details step, or upload a logo instead.'
    );
  }

  const inner = px * 0.62;
  const fitted = Math.min(
    (inner * REF_SIZE) / measure(font, initials).width,
    inner
  );

  // Centred on the ink for the same reason the wordmark is. The initials are
  // always capitals, so cap height would have worked here — but having two
  // different centring rules in one file is how the next person introduces
  // the bug this one already had.
  const line = linePath(font, initials, fitted);

  const x = (px - line.width) / 2;
  const y = (px - (line.bbox.y2 - line.bbox.y1)) / 2 - line.bbox.y1;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${px} ${px}">` +
    tile +
    `<g fill="#ffffff"><path transform="translate(${x.toFixed(2)} ${y.toFixed(2)})" d="${line.d}"/></g>` +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------
// FILES
// ---------------------------------------------------------------------------
/** A transparent PNG of the wordmark, as a buffer. */
async function wordmarkPng(options) {
  return sharp(Buffer.from(wordmarkSvg(options))).png().toBuffer();
}

/**
 * Write both files, and return them in the shape runGeneration already uses
 * for an uploaded logo: paths relative to the site root.
 *
 * The same `assets/<prefix>-logo.png` name the upload path writes, so nothing
 * downstream — the <img>, the JSON-LD, the favicon <link>, the WordPress
 * exporter, the published site's own store — learns that a second kind of
 * logo exists.
 */
async function writeWordmark({ businessName, logoType, styleKey, structure, trade = '',
                               assetsDir, logoFilename, faviconFilename }) {
  const font = loadFont();

  const logoBuf = await sharp(
    Buffer.from(wordmarkSvg({ businessName, logoType, styleKey, structure, trade, font }))
  ).png().toBuffer();

  const faviconBuf = await sharp(
    Buffer.from(faviconSvg({ businessName, styleKey, structure, trade, font }))
  ).resize(42, 42).png().toBuffer();

  await fs.promises.writeFile(path.join(assetsDir, logoFilename), logoBuf);
  await fs.promises.writeFile(path.join(assetsDir, faviconFilename), faviconBuf);

  return {
    logo: `assets/${logoFilename}`,
    favicon: `assets/${faviconFilename}`,
  };
}

module.exports = {
  THEME_INK,
  STRUCTURE_INK,
  INK_FALLBACK,
  MAX_NAME_CHARS,
  SCALE,
  inkFor,
  paletteFor,
  loadFont,
  sanitizeName,
  initialsFor,
  measure,
  lineCandidates,
  fitSize,
  planLines,
  linePath,
  wordmarkSvg,
  faviconSvg,
  wordmarkPng,
  writeWordmark,
  _resetFontCache,
};
