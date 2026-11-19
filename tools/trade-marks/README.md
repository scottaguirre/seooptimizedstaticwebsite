# Trade marks — a symbol per trade, as SVG path data

**Twenty-three marks covering all twenty-five trades**, drawn 18 November. **Nothing here is wired into the
build.** `utils/wordmarkLogo.js` does not import it and no site renders it.
It lives under `tools/` for the same reason `tools/preview-structure.js`
does: it is how something is looked at before it is live, and `tools/` is in
`.rsync-exclude`, so it never reaches the server.

    node preview.js      writes sheet.png and lockup.png beside this file

## Why paths and not PNG files

The logo lands on **eight themes and seven structures** — navy, black, light
grey, white, a photograph — which is why `wordmarkLogo.js` carries a whole
`THEME_INK` / `STRUCTURE_INK` table. A PNG has its colour baked in, so a set
of marks as images means one file per trade *per ink colour per size*. A path
takes its `fill` at draw time from the palette the letters already use, so
the mark can never disagree with the name beside it.

Three smaller reasons: the logo is drawn at 120x120, 150x100, 250x100 and a
42px favicon, and a vector holds up at all four; the favicon is initials on a
tile today and a trade mark is a better one; and the comment at the top of
`wordmarkLogo.js` explains why glyphs become paths at all — librsvg on the
VPS has no fonts, so anything resolved at render time ships blank. A path is
geometry. So is a mark.

## The rules that make six drawings look like one set

  - One **100x100 box**, artwork inside ±40, placed by a single translate.
  - **Fill only, no strokes.** One `fill` on the group colours the whole
    mark. A stroked path needs its own colour and would be missed.
  - **Masses 9–13 units thick.** Weight is what makes a set look like a set;
    a mark drawn lighter than its neighbours reads as a different family
    even when the shape is right.
  - Every mark is **checked at 28px**, not just at 120.

## What went wrong, so it is not rediscovered

  - **Even-odd subtracts where shapes OVERLAP. It does not clip.** The
    wrench's jaw was a circle with a rectangle laid over it; the part of the
    rectangle outside the circle counted as inside one subpath and filled, so
    the wrench had a block stuck to its jaw. The jaw is now one outline.
  - **A shape that needs a detail to be right is the wrong shape.** The roof
    had two little eave stubs. At 120px they read as feet; at 28px they were
    two grey pixels and the roof looked chipped.
  - **When a shape will not read, change the object, not the drawing.**
    Concrete took three goes. Face-on, a finishing float is a rectangle with
    a stub: everyone saw a mallet. From the side it is an arch on a bar:
    everyone saw a bell. A float has no silhouette — it is a flat board, and
    a flat board from any angle is a board. The pointing trowel has a
    silhouette nothing else shares.

## Which trade gets which mark

`FOR_TRADE` maps a trade to a mark, and several trades share one. Edwin,
18 November: *"Lemon law and any other lawyer a gavle, Web design a laptop,
coding the same a laptop"* — so the gavel is the mark for every legal trade
rather than for lemon law alone, and web design and coding reading as one
thing is a decision, not an oversight. Air conditioning takes the HVAC fan
for the same reason.

Edwin again, on the medical ones: *"Chiropractor a human spine, physical
therapy a bending leg, doctor a stetoscope"*.

All twenty-five covered. Two marks serve two trades each: HVAC and Air
Conditioning share the fan, Web Design and Coding share the laptop.

## What the medical three taught, which was mostly about VIEW and GAP

  - **A repeated asymmetry becomes a shape nobody drew.** The spine's first
    two attempts were drawn from the side, where a vertebra is a block with
    a spur behind it. The spur is on the same side of every block, so it
    stacked into a line of its own and the eye followed that instead of the
    column: a feather, then a row of bullets. From the front a vertebra is
    symmetrical and nothing accumulates.
  - **A column of repeated parts is read by its gaps**, and **spacing is
    arithmetic, not taste**. Edwin picked the version with a disc between
    each pair of vertebrae — the right anatomy — and the first cut of it
    merged into one bar at 28px. At that size one unit of this 100-unit box
    is 0.28 of a pixel, so a gap under about four units is not a gap, it is
    an edge that closes. That version had 0.95 units of air either side of
    each disc: a quarter of a pixel. Four vertebrae rather than six buys
    3.9 units, which is a whole pixel, and survives. *Half the pitch, minus
    the vertebra, minus the disc, is the air — and if that number is small
    the drawing is already wrong, whatever it looks like at full size.*
  - **The waist is what makes a block a vertebra.** A vertebral body seen
    from the front is wider at its end plates than through its middle, and
    that single concave edge is the whole difference between a spine and a
    stack of rounded bars. Nothing else in the set has a concave edge, so
    the spine cannot be confused with any of them. Deeper is not better:
    at a waist of 4.6 it is handsome at 130px and pinches shut at 28.
  - **Lean was tried at 11 and 22 degrees and both read as slashes.** The
    offset alone carries the curve; the blocks stay level. Four variants
    were rendered side by side and chosen by looking — `node try.js` in the
    session, not kept, but the method is the point: argue less, render more.
  - **A leg is not two angles. It is one angle and a vertical.** Thigh
    down-right, shin down-left, foot off the end is a Z — and there is a
    lightning bolt two cells along in the same set.
  - **Symmetry killed the stethoscope.** Two matching arms meeting at a
    point with a disc under them is a pendant. A stethoscope is a lopsided
    object: the headset is a U and ONE tube leaves it for the bell.

## Two things the gavel and the laptop each taught

  - **A gavel without its block is a hammer.** The two are the same
    silhouette; the block underneath is the entire difference between a
    lawyer and a carpenter. It is the widest mass in the mark so it survives
    28px, and it is not decoration to be trimmed later.
  - **An outlined screen closes up.** A 4-unit bezel on a 28px mark is under
    a pixel and fills to a solid block anyway, so the screen is solid from
    the start and the picture is the same at every size. The base being
    wider than the screen is the whole of the perspective, and the only
    thing stopping it reading as a television.

## What the second batch taught

  - **A hole is not a lighter shape.** Paving's centre line was drawn as
    separate paths over the road and painted the same colour as the road,
    because everything here takes one fill from the group — which is the
    whole point of it, and means a mark can have no second colour, ever. The
    dashes had to be punched out of the SAME path with `evenodd`.
  - **When the verb will not draw, draw the tool.** "Tree removal" is an
    event, and events need a before and an after. A leaning tree over a
    stump was a lollipop; lumping the crown made it broccoli; a stump with
    growth rings was a mushroom on a plank. A tree beside an axe reads at
    once. The axe needs a HEAD, or it is a fallen log.
  - **Sometimes draw the result instead.** The opposite choice, one cell
    along: a mower read as a wheelbarrow, because a deck, a handle and two
    wheels IS a cart — what makes a mower a mower does not survive this
    size. Grass is unambiguous where the tool is not.
  - **The detail that names an object must not be the detail that destroys
    it.** The moving carton's tape was 9 units and its flap notch 16 tall,
    and between them they cut the box into three bars. Tape is what makes a
    square a carton; it still has to leave a square.
  - **Some objects are named by their setting.** A perforated pipe on its
    own is a tube with dots. Gravel above it and ground below it make it a
    French drain.

## Still to decide, before any of this is wired in

  - **Two plumbers would get the same mark** — the complaint about services,
    again. The fix is the same: a few variants per trade, chosen by a hash of
    the business name, the way `chooseServices()` does it.
  - **Where the mark goes in the three logo shapes.** Beside the name on the
    wide 250x100 box is obvious; above it on the 120x120 square is not.
