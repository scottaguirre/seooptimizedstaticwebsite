'use strict';

/**
 * Trade marks: one flat symbol per trade, as SVG path data.
 *
 * ONE 100x100 BOX, ARTWORK INSIDE ±40, drawn around the origin and placed by
 * a single translate. Every mark is fill-only — no strokes — so one `fill` on
 * the group colours the whole thing, which is the entire reason these are
 * paths and not PNG files: the logo lands on eight themes and seven
 * structures, and the ink is chosen at draw time.
 *
 * WEIGHT IS THE THING THAT MAKES A SET LOOK LIKE A SET. The masses here are
 * 9-13 units thick. A mark drawn lighter than its neighbours reads as a
 * different family even when the shape is right.
 */

const n = v => Number(v.toFixed(2));
const pts = list => 'M' + list.map(([x, y]) => `${n(x)} ${n(y)}`).join('L') + 'Z';

function hex(cx, cy, r, rot = 0) {
  const p = [];
  for (let i = 0; i < 6; i += 1) {
    const a = rot + (Math.PI / 3) * i;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts(p);
}

/* ------------------------------------------------------------------ */
/* PLUMBING — a combination wrench.                                     */
/*                                                                      */
/* ⚠ THE JAW IS ONE OUTLINE, NOT A CIRCLE WITH A SLOT SUBTRACTED. The   */
/* first version laid a rectangle over the circle with fill-rule        */
/* evenodd; the part of the rectangle OUTSIDE the circle counted as     */
/* inside one subpath and filled, so the wrench had a block stuck to    */
/* its jaw. Even-odd subtracts where shapes OVERLAP. It does not clip.  */
/* ------------------------------------------------------------------ */
function plumbing({ thick = 5.2, ringR = 14.5, ringHole = 8.6,
                    jawR = 13.5, mouth = 6.6, seatIn = 5.5 } = {}) {
  const ringX = 26;
  const jawX = -26;
  const d = Math.sqrt(jawR * jawR - mouth * mouth);
  const lip = n(jawX - d);
  const seat = n(jawX + seatIn);

  return {
    rotate: -42,
    paths: [
      `M${seat} ${-thick}L${ringX} ${-thick}a${thick} ${thick} 0 0 1 0 ${thick * 2}L${seat} ${thick}Z`,
      `M${ringX - ringR} 0a${ringR} ${ringR} 0 1 0 ${ringR * 2} 0a${ringR} ${ringR} 0 1 0 ${-ringR * 2} 0Z`
        + hex(ringX, 0, ringHole, Math.PI / 6),
      `M${lip} ${-mouth}L${seat} ${-mouth}L${seat} ${mouth}L${lip} ${mouth}`
        + `A${jawR} ${jawR} 0 1 0 ${lip} ${-mouth}Z`,
    ],
  };
}

/* ROOFING — a gable with a chimney.
 *
 * ⚠ THE EAVES CAME OFF. The first version finished the band with two little
 * stubs so it did not end in mid-air. At 120px they read as feet; at 28px
 * they were two grey pixels and the roof looked chipped. A shape that needs
 * a detail to be right is the wrong shape — the band now simply ends, and
 * the chimney gives the eye the one asymmetry it wants.
 *
 * OFFSET STRAIGHT DOWN, NOT ALONG THE NORMAL. A perpendicular offset tapers
 * the ends, which at small sizes reads as a bent stick rather than a roof. */
function roofing({ span = 42, apex = -26, foot = 12, band = 15 } = {}) {
  return {
    paths: [
      // behind the roof, so the join needs no mitre
      `M15 ${apex - 12}h13v30h-13Z`,
      pts([
        [-span, foot], [0, apex], [span, foot],
        [span, foot + band], [0, apex + band], [-span, foot + band],
      ]),
    ],
  };
}

/* ELECTRICIAN — a bolt. The one symbol on this list nobody has to be told
 * the meaning of, which is worth more than originality. */
function electrician() {
  return {
    paths: [pts([
      [7, -38], [-18, 3], [-3, 3], [-9, 38], [18, -5], [3, -5],
    ])],
  };
}

/* CONCRETE — a pointing trowel: tapered blade, shank, barrel handle.
 *
 * ⚠ TWO WRONG ANSWERS BEFORE THIS ONE, and both were about the VIEW rather
 * than the drawing. Face-on, a finishing float is a rectangle with a stub on
 * it: everyone read it as a mallet. From the side it is an arch on a bar:
 * everyone read it as a bell. The float has no silhouette — it is a flat
 * board, and a flat board seen from any angle is a board.
 *
 *     WHEN A SHAPE WILL NOT READ, CHANGE THE OBJECT, NOT THE DRAWING.
 *
 * The pointing trowel has a silhouette nothing else shares: a blade that
 * tapers to a point, a thin shank, a fat handle. It is also the tool anyone
 * picturing wet concrete pictures. */
function concrete({ halfHeel = 20, tip = 36, heelY = -10 } = {}) {
  return {
    rotate: -35,
    paths: [
      `M${-halfHeel} ${heelY}q0 -5 5 -5h${halfHeel * 2 - 10}q5 0 5 5L0 ${tip}Z`,
      `M-4.5 -22h9v13h-9Z`,
      `M-9.5 -27h19v6h-19Z`,
      `M-8 -48h16a8 8 0 0 1 8 8v12a8 8 0 0 1 -8 8h-16a8 8 0 0 1 -8 -8v-12a8 8 0 0 1 8 -8Z`,
    ],
  };
}

/* HVAC — a fan in its ring. Three blades at 120°, each a leaf drawn once
 * and rotated by the renderer, so they cannot drift apart. */
function hvac({ ring = 38, ringIn = 31, hub = 7.5 } = {}) {
  const blade = 'M0 0C10 -8 13 -20 7 -28C2 -34 -8 -33 -12 -26C-16 -18 -9 -6 0 0Z';

  return {
    paths: [
      `M${-ring} 0a${ring} ${ring} 0 1 0 ${ring * 2} 0a${ring} ${ring} 0 1 0 ${-ring * 2} 0Z`
        + `M${-ringIn} 0a${ringIn} ${ringIn} 0 1 1 ${ringIn * 2} 0a${ringIn} ${ringIn} 0 1 1 ${-ringIn * 2} 0Z`,
      { d: blade, rotate: 0 },
      { d: blade, rotate: 120 },
      { d: blade, rotate: 240 },
      `M${-hub} 0a${hub} ${hub} 0 1 0 ${hub * 2} 0a${hub} ${hub} 0 1 0 ${-hub * 2} 0Z`,
    ],
  };
}

/* PAINTER — a roller: head, a bent arm, a grip.
 *
 * ⚠ THE ARM IS THE WHOLE MARK. The first version had a thick stub between
 * the head and the grip, and the three parts read as three separate blocks
 * — a roller is a head on the end of a BENT ROD, and if the bend is not
 * obviously thinner than the things it joins, there is no rod, only a pile.
 * The arm is now 5 units against the head's 20 and the grip's 18. */
function painter() {
  return {
    paths: [
      `M-38 -36h32a9 9 0 0 1 9 9v10a9 9 0 0 1 -9 9h-32a9 9 0 0 1 -9 -9v-10a9 9 0 0 1 9 -9Z`,
      `M3 -29h15v5h-15Z`,
      `M13 -29h5v33h-5Z`,
      `M6 0h12a8 8 0 0 1 8 8v22a8 8 0 0 1 -8 8h-12a8 8 0 0 1 -8 -8v-22a8 8 0 0 1 8 -8Z`,
    ],
  };
}

/* LAWYER — a gavel on its block. Edwin, 18 November: *"Lemon law and any
 * other lawyer a gavle"*, so this is the mark for every legal trade, not
 * for lemon law alone.
 *
 * THE BLOCK IS NOT DECORATION. A head on a handle with no block is a
 * HAMMER, and the two are the same silhouette — the block under it is the
 * entire difference between a lawyer and a carpenter. It stays at every
 * size for that reason, and is the widest mass in the mark so it survives
 * 28px. */
function lawyer({ head = 23, headH = 10, grip = 4.6, reach = 46 } = {}) {
  return {
    groups: [
      {
        transform: 'translate(-7 -16) rotate(-40)',
        paths: [
          `M${-head + 5} ${-headH}h${(head - 5) * 2}a5 5 0 0 1 5 5v${headH * 2 - 10}`
            + `a5 5 0 0 1 -5 5h${-(head - 5) * 2}a5 5 0 0 1 -5 -5v${-(headH * 2 - 10)}`
            + `a5 5 0 0 1 5 -5Z`,
          `M${-grip} 6h${grip * 2}v${reach - 6 - grip}a${grip} ${grip} 0 0 1 ${-grip * 2} 0Z`,
        ],
      },
    ],
    paths: [`M-32 30h64a5 5 0 0 1 0 12h-64a5 5 0 0 1 0 -12Z`],
  };
}

/* LAPTOP — web design and coding both. Edwin: *"Web design a laptop, coding
 * the same a laptop"*, which is a decision about those two trades reading
 * as one thing, not an oversight.
 *
 * THE SCREEN IS SOLID, NOT A BEZEL. An outlined screen is the prettier
 * drawing and it closes up at 28px — a 4-unit bezel on a 28px mark is under
 * a pixel and fills to a block anyway. Solid from the start is the same
 * picture at every size.
 *
 * THE BASE IS WIDER THAN THE SCREEN, which is the whole of the perspective
 * and the only thing stopping this reading as a television. */
function laptop({ sw = 30, top = -32, hinge = 5, baseW = 40, baseY = 7, baseH = 12 } = {}) {
  return {
    paths: [
      `M${-sw + 4} ${top}h${(sw - 4) * 2}a4 4 0 0 1 4 4v${Math.abs(top) + hinge - 8}`
        + `a4 4 0 0 1 -4 4h${-(sw - 4) * 2}a4 4 0 0 1 -4 -4v${-(Math.abs(top) + hinge - 8)}`
        + `a4 4 0 0 1 4 -4Z`,
      pts([
        [-sw - 2, baseY], [sw + 2, baseY],
        [baseW, baseY + baseH], [-baseW, baseY + baseH],
      ]),
    ],
  };
}

/* CHIROPRACTOR — a spine, seen from the front.
 *
 * ⚠ TWO WRONG ANSWERS, AND BOTH CAME FROM DRAWING IT FROM THE SIDE. Seen
 * from the side a vertebra is a block with a spur behind it, and a stack of
 * those is a fringe: the first attempt read as a feather, the second as a
 * row of bullets. The spur is on ONE side of every block, so it stacks into
 * a line of its own and the eye follows that line instead of the column.
 *
 *     A REPEATED ASYMMETRY BECOMES A SHAPE NOBODY DREW.
 *
 * From the front a vertebra is symmetrical, so nothing accumulates down one
 * edge. A wing either side was tried and read as a barbell; a plain block
 * is better. The lean was tried too, at 11 and at 22 degrees, and both read
 * as a stack of slashes — the OFFSET alone carries the curve, and the
 * blocks stay level.
 *
 * THE GAP IS WHAT MAKES IT A COLUMN. A run of repeated parts is read by
 * its gaps; when the gap is smaller than the part there are no parts, only
 * a texture. The disc sitting in each gap is the right anatomy and costs
 * air, which is why there are four vertebrae here and not six — see the
 * arithmetic below. */
function chiropractor({ count = 4, top = -33, span = 68, sway = 5.5,
                        h = 5.8, waist = 3.8, w0 = 11.5, w1 = 9, r = 1.6,
                        discH = 1.6, discW = 0.6 } = {}) {
  /* THE WAIST IS WHAT MAKES A BLOCK A VERTEBRA. A vertebral body seen from
   * the front is wider at its end plates than through its middle, and that
   * one concave edge is the whole difference between a spine and a stack of
   * rounded bars. Nothing else in this set has a concave edge.
   *
   * DEEPER IS NOT BETTER. At a waist of 4.6 the shape is handsome at 130px
   * and pinches shut at 28; 3.8 reads at both.
   *
   * THE DISC BETWEEN EACH PAIR IS BUDGETED, NOT GUESSED. At 28px one unit
   * of this 100-unit box is 0.28 of a pixel, so a gap under about four
   * units is not a gap — it is an edge that closes. The first version with
   * discs had 0.95 units of air either side (a quarter of a pixel) and the
   * whole column merged into one bar. Four vertebrae rather than six buys
   * 3.9 units each side, which is a pixel and survives.
   *
   *     SPACING IS ARITHMETIC, NOT TASTE. Half the pitch, minus the
   *     vertebra, minus the disc, is the air — and if that number is
   *     small the drawing is already wrong, whatever it looks like at
   *     full size. */
  const bone = (w) =>
    `M${n(-w + r)} ${-h}`
    + `H${n(w - r)}Q${n(w)} ${-h} ${n(w)} ${n(-h + r)}`
    + `Q${n(w - waist)} 0 ${n(w)} ${n(h - r)}`
    + `Q${n(w)} ${n(h)} ${n(w - r)} ${n(h)}`
    + `H${n(-w + r)}Q${n(-w)} ${n(h)} ${n(-w)} ${n(h - r)}`
    + `Q${n(-w + waist)} 0 ${n(-w)} ${n(-h + r)}`
    + `Q${n(-w)} ${-h} ${n(-w + r)} ${-h}Z`;

  const disc = (w) =>
    `M${n(-w + discH)} ${-discH}h${n((w - discH) * 2)}a${discH} ${discH} 0 0 1 0 ${discH * 2}`
    + `h${n(-(w - discH) * 2)}a${discH} ${discH} 0 0 1 0 ${-discH * 2}Z`;

  const x = t => sway * Math.sin(2 * Math.PI * t);
  const y = t => top + span * t;
  const wide = t => w0 - (w0 - w1) * t;      // narrowing towards the neck
  const paths = [];

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);

    paths.push({ d: bone(wide(t)), at: `translate(${n(x(t))} ${n(y(t))})` });

    if (i < count - 1) {
      const m = (i + 0.5) / (count - 1);

      paths.push({ d: disc(wide(m) * discW), at: `translate(${n(x(m))} ${n(y(m))})` });
    }
  }

  return { paths };
}

/* PHYSICAL THERAPY — a leg bent at the knee.
 *
 * ⚠ THE FIRST ONE WAS A Z. Thigh down-right, shin down-left, foot off the
 * end: three bars zig-zagging, which is an arrow or a lightning stroke, and
 * this file already has a lightning stroke two cells along.
 *
 *     A LEG IS NOT TWO ANGLES. IT IS ONE ANGLE AND A VERTICAL.
 *
 * Drawn seated: the thigh runs out to the knee, the shin drops straight
 * down from it, and the foot turns forward at the bottom. The knee is the
 * widest joint because that is the one the trade is about. */
function physicaltherapy({ bone = 9.5, hip = [-26, -20], knee = [13, -12], ankle = [13, 22] } = {}) {
  const bar = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    const r = bone / 2;

    return {
      d: `M0 ${-r}h${n(len)}a${r} ${r} 0 0 1 0 ${bone}h${n(-len)}a${r} ${r} 0 0 1 0 ${-bone}Z`,
      at: `translate(${a[0]} ${a[1]}) rotate(${n(deg)})`,
    };
  };

  const dot = (c, r) => `M${c[0] - r} ${c[1]}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

  return {
    paths: [
      bar(hip, knee),
      bar(knee, ankle),
      dot(hip, 7),
      dot(knee, 9),
      `M${ankle[0] - 5} ${ankle[1] - 1}h24a5.5 5.5 0 0 1 0 11h-24a5.5 5.5 0 0 1 0 -11Z`,
    ],
  };
}

/* DOCTOR — a stethoscope.
 *
 * ⚠ THE FIRST ONE WAS A NECKLACE. Two symmetrical arms meeting at a point
 * with a disc hanging under them is a pendant, and nothing about it says
 * medicine. The fix is ASYMMETRY: the headset is a U, and ONE tube leaves
 * it and travels away to the bell. A stethoscope is a lopsided object and
 * drawing it symmetrically is what removed the meaning.
 *
 * THE TUBES ARE FILLED OUTLINES, NOT STROKES. Everything here takes one
 * `fill` from the group; a stroked path needs its own colour and would come
 * out invisible the first time the mark was drawn in white. Each tube is a
 * curve out and the same curve back, offset by its own width — which is
 * what a stroke is, done where it can be seen. */
function doctor({ tube = 3.5, knob = 5.2, bell = [19, 21], bellR = 11.5 } = {}) {
  // the headset: two arms from the ear knobs down to where they join
  const arm = (side) => {
    const x = 21 * side;
    const cx = 26 * side;

    return `M${n(x - tube * side)} -31`
      + `Q${n(cx - tube * side)} -6 ${n(2 * side - tube * side)} 4`
      + `L${n(2 * side + tube * side)} 4`
      + `Q${n(cx + tube * side)} -6 ${n(x + tube * side)} -31Z`;
  };

  return {
    paths: [
      arm(1),
      arm(-1),
      `M${-21 - knob} -31a${knob} ${knob} 0 1 0 ${knob * 2} 0a${knob} ${knob} 0 1 0 ${-knob * 2} 0Z`,
      `M${21 - knob} -31a${knob} ${knob} 0 1 0 ${knob * 2} 0a${knob} ${knob} 0 1 0 ${-knob * 2} 0Z`,
      // the one tube that leaves the headset, which is the whole of the asymmetry
      `M${-tube} 2Q${n(-tube + 1)} 14 ${n(bell[0] - 2)} ${n(bell[1] - bellR + 2)}`
        + `L${n(bell[0] + 2)} ${n(bell[1] - bellR - 2)}`
        + `Q${n(tube + 1)} 12 ${tube} 2Z`,
      `M${bell[0] - bellR} ${bell[1]}a${bellR} ${bellR} 0 1 0 ${bellR * 2} 0`
        + `a${bellR} ${bellR} 0 1 0 ${-bellR * 2} 0Z`,
    ],
  };
}

/* ---------------------------------------------------------------- */
/* THE SECOND BATCH. Same rules: one 100x100 box, fill only, masses   */
/* 9-13 units, and every one looked at at 28px before it is kept.     */
/* ---------------------------------------------------------------- */

/* DENTIST — a molar. One closed shape, which is why it was quick: the
 * trouble in this set has always come from marks made of repeated or
 * jointed parts, and a tooth is neither. */
function dentist() {
  return {
    paths: [
      'M0 -31C-18 -31 -26 -20 -24 -7C-22 5 -18 13 -16 26C-15 34 -5 34 -4 26'
      + 'L-1 9H1L4 26C5 34 15 34 16 26C18 13 22 5 24 -7C26 -20 18 -31 0 -31Z',
    ],
  };
}

/* EYE DOCTOR — an eye: a lens outline with a solid iris. The outline is a
 * band rather than a stroke, like every other curve here. */
function eyedoctor({ w = 36, h = 25, inset = 7, iris = 10.5 } = {}) {
  return {
    paths: [
      `M${-w} 0Q0 ${-h} ${w} 0Q0 ${h} ${-w} 0Z`
        + `M${-w + inset} 0Q0 ${-h + inset} ${w - inset} 0Q0 ${h - inset} ${-w + inset} 0Z`,
      `M${-iris} 0a${iris} ${iris} 0 1 0 ${iris * 2} 0a${iris} ${iris} 0 1 0 ${-iris * 2} 0Z`,
    ],
  };
}

/* FENCING — pickets and rails. THE POINTED TOP IS THE WHOLE MARK: square
 * tops and this is a bar chart. */
function fencing({ xs = [-24, 0, 24], half = 5.4, top = -32, foot = 30 } = {}) {
  const picket = x =>
    `M${x - half} ${top + 11}L${x} ${top}L${x + half} ${top + 11}V${foot}h${-half * 2}Z`;

  const rail = y => `M-36 ${y}h72v9h-72Z`;

  return { paths: [rail(-9), rail(11), ...xs.map(picket)] };
}

/* TREE REMOVAL — a tree and an axe.
 *
 * ⚠ TWO WRONG ANSWERS FIRST, AND BOTH WERE ABOUT THE SECOND OBJECT. A tree
 * alone is landscaping, which is the cell next door. Leaning it over a
 * stump was the first try: a smooth crown on a thin stick, tilted, is a
 * lollipop, and lumping the crown only turned it into broccoli. A stump
 * with growth rings was the second: a mushroom on a plank.
 *
 *     WHEN THE VERB WILL NOT DRAW, DRAW THE TOOL. "Removal" is an event
 *     and events need a before and an after; an axe needs neither.
 *
 * THE AXE NEEDS A HEAD. Without the wedge it is a slanted bar, which reads
 * as a fallen log — and a tree beside a log is a tree beside a log. */
function treeremoval() {
  return {
    paths: [
      'M-24 -16a13 13 0 1 1 8 -23a14 14 0 0 1 21 10a12 12 0 0 1 -6 23Z',
      'M-13 -16h10v32h-10Z',
      // the handle, then the wedge at its head
      'M14 34L30 2a5.5 5.5 0 0 1 9.6 5L23.6 39Z',
      'M28 -4l10 -2a13 13 0 0 1 9 13l-9 4Z',
    ],
  };
}

/* LANDSCAPING — grass.
 *
 * ⚠ A MOWER WAS TRIED AND READ AS A WHEELBARROW. A deck, a handle and two
 * wheels is a cart; what makes a mower a mower is the housing and the
 * blade, neither of which survives being drawn at this size.
 *
 * Grass is the RESULT rather than the tool, which is the opposite choice to
 * the tree next door — and it is the right one here, because the tool is
 * ambiguous and the result is not. A shrub beside it was tried too and read
 * as a blob. */
function landscaping() {
  return {
    paths: [
      'M0 24C-4 10 -4 -4 0 -22C4 -4 4 10 0 24Z',
      'M-10 26C-18 14 -22 2 -22 -12C-14 0 -10 12 -10 26Z',
      'M10 26C18 14 22 2 22 -12C14 0 10 12 10 26Z',
      'M-36 24h72a6 6 0 0 1 0 12h-72a6 6 0 0 1 0 -12Z',
    ],
  };
}

/* PAVING — a road running away from you, with its centre line.
 *
 * ⚠ THE CENTRE LINE WAS INVISIBLE AND THE BUG WAS OBVIOUS IN HINDSIGHT.
 * The dashes were separate <path> elements in a group with one fill, so
 * they were painted the same colour as the road they sit on. Everything in
 * this file takes its colour from the group — which is the point of it —
 * and that means a mark can have no second colour, ever.
 *
 *     A HOLE IS NOT A LIGHTER SHAPE. IT IS AN ABSENCE, AND IT HAS TO BE
 *     PUNCHED OUT OF THE SAME PATH.
 *
 * Road and dashes are now ONE path, and `fill-rule="evenodd"` on the group
 * cuts them out. */
function paving() {
  return {
    paths: [
      pts([[-14, -30], [14, -30], [36, 32], [-36, 32]])
        + 'M-3.5 -22h7l1.6 13h-10.2Z'
        + 'M-5.2 -3h10.4l1.9 15h-14.2Z'
        + 'M-7.2 18h14.4l2.2 16h-18.8Z',
    ],
  };
}

/* SWIMMING POOL — a ladder standing in water.
 *
 * ⚠ THE FIRST RAILS WERE HOOKS. They curved over at the top and read as two
 * question marks, or as taps. A pool ladder's rails are STRAIGHT with a
 * rounded cap; the curve belongs at the bottom, under the water, where it
 * is not drawn at all. */
function swimmingpool({ rail = 4.6, x1 = -15, x2 = 15, top = -32, foot = 6 } = {}) {
  const post = x => `M${x - rail} ${top + rail}a${rail} ${rail} 0 0 1 ${rail * 2} 0`
    + `V${foot}h${-rail * 2}Z`;
  const rung = y => `M${x1} ${y}h${x2 - x1}v7h${-(x2 - x1)}Z`;
  const wave = (y, h) => `M-38 ${y}c8 0 8 -7 16 -7s8 7 16 7s8 -7 16 -7s8 7 16 7v${h}`
    + `c-8 0 -8 -7 -16 -7s-8 7 -16 7s-8 -7 -16 -7s-8 7 -16 7Z`;

  return { paths: [post(x1), post(x2), rung(-19), rung(-5), wave(14, 10), wave(30, 9)] };
}

/* JUNK REMOVAL — a skip. Wider at the top, with a lip: a plain box is the
 * moving carton next door. */
function junkremoval() {
  return {
    paths: [
      'M-38 -16h76a4.5 4.5 0 0 1 0 10h-76a4.5 4.5 0 0 1 0 -10Z',
      pts([[-34, -3], [34, -3], [26, 30], [-26, 30]]),
    ],
  };
}

/* MOVING COMPANY — a taped carton.
 *
 * ⚠ THE FIRST ONE WAS TWO BARS. The tape was 9 units and the flap notch was
 * 16 tall, and between them they cut the box into three pieces — at which
 * point there is no box, only the pieces. Both are now as thin as they can
 * be and still be seen: the tape is what makes a square a carton, and it
 * must not be what destroys it. */
function movingcompany() {
  return {
    paths: [
      'M-32 -26h64a6 6 0 0 1 6 6v40a6 6 0 0 1 -6 6h-64a6 6 0 0 1 -6 -6v-40a6 6 0 0 1 6 -6Z'
        + 'M-4 -26h8v11h-8Z'
        + 'M-38 -8h76v5.5h-76Z',
    ],
  };
}

/* APPLIANCE REPAIR — a washing machine: door, and two controls. The round
 * door in a square body is the whole of it. */
function appliancerepair({ door = 15 } = {}) {
  return {
    paths: [
      'M-30 -34h60a7 7 0 0 1 7 7v54a7 7 0 0 1 -7 7h-60a7 7 0 0 1 -7 -7v-54a7 7 0 0 1 7 -7Z'
        + `M${-door} 7a${door} ${door} 0 1 1 ${door * 2} 0a${door} ${door} 0 1 1 ${-door * 2} 0Z`
        + 'M14 -24a4.5 4.5 0 1 1 9 0a4.5 4.5 0 1 1 -9 0Z'
        + 'M-1 -24a4.5 4.5 0 1 1 9 0a4.5 4.5 0 1 1 -9 0Z',
    ],
  };
}

/* WATER DAMAGE — a drop falling into standing water.
 *
 * A DROP ON ITS OWN IS PLUMBING. The water UNDER it is what makes it
 * damage: one drop is a leak, a floor with water on it is the job. */
function waterdamage() {
  return {
    paths: [
      'M0 -34C-9 -20 -17 -11 -17 -3a17 17 0 0 0 34 0C17 -11 9 -20 0 -34Z',
      'M-38 20c8 0 8 -7 16 -7s8 7 16 7s8 -7 16 -7s8 7 16 7v10c-8 0 -8 -7 -16 -7'
        + 's-8 7 -16 7s-8 -7 -16 -7s-8 7 -16 7Z',
    ],
  };
}

/* FRENCH DRAIN — a perforated pipe bedded in gravel.
 *
 * ⚠ THE FIRST ONE WAS A SAUSAGE. A tilted bar with three dots in it is a
 * tilted bar with three dots in it; nothing said pipe and nothing said
 * buried. Level it, open the holes until they are unmistakably holes, and
 * put gravel above and ground below — the SETTING is what names this one,
 * because the object on its own is a tube. */
function frenchdrain({ len = 34, r = 11 } = {}) {
  const hole = x => `M${x - 4.4} 0a4.4 4.4 0 1 1 8.8 0a4.4 4.4 0 1 1 -8.8 0Z`;
  const stone = (x, y, rr) => `M${x - rr} ${y}a${rr} ${rr} 0 1 0 ${rr * 2} 0a${rr} ${rr} 0 1 0 ${-rr * 2} 0Z`;

  return {
    paths: [
      `M${-len} ${-r + 4}h${len * 2}a${r} ${r} 0 0 1 0 ${r * 2}h${-len * 2}`
        + `a${r} ${r} 0 0 1 0 ${-r * 2}Z`
        + hole(-20) + hole(0) + hole(20),
      stone(-26, -23, 5), stone(-9, -28, 4.4), stone(8, -23, 5.2), stone(25, -28, 4.4),
      'M-38 26h76a5 5 0 0 1 0 10h-76a5 5 0 0 1 0 -10Z',
    ],
  };
}

const MARKS = {
  plumbing, roofing, electrician, concrete, hvac, painter, lawyer, laptop,
  chiropractor, physicaltherapy, doctor,
  dentist, eyedoctor, fencing, treeremoval, landscaping, paving,
  swimmingpool, junkremoval, movingcompany, appliancerepair, waterdamage,
  frenchdrain,
};

/* WHICH MARK A TRADE GETS. Several trades share one — Edwin asked for web
 * design and coding to be the same laptop, and a gavel covers every legal
 * trade rather than lemon law alone. The map is the place that says so;
 * MARKS above is only the drawings. */
const FOR_TRADE = {
  plumbing: 'plumbing',
  roofing: 'roofing',
  electrician: 'electrician',
  'concrete-contractor': 'concrete',
  hvac: 'hvac',
  'air-conditioning': 'hvac',
  painter: 'painter',
  'lemon-law': 'lawyer',
  chiropractor: 'chiropractor',
  'physical-therapy': 'physicaltherapy',
  doctor: 'doctor',
  dentist: 'dentist',
  'eye-doctor': 'eyedoctor',
  fencing: 'fencing',
  'tree-removal': 'treeremoval',
  landscaping: 'landscaping',
  paving: 'paving',
  'swimming-pool-contractor': 'swimmingpool',
  'junk-removal': 'junkremoval',
  'moving-company': 'movingcompany',
  'appliance-repair': 'appliancerepair',
  'water-damage-restoration': 'waterdamage',
  'french-drain-installation': 'frenchdrain',
  'web-design': 'laptop',
  coding: 'laptop',
};

/** One mark as an <svg> string, at any size, in any ink. */
function markSvg(trade, { size = 120, fill = '#20291f', scale = 1 } = {}) {
  const make = MARKS[trade];

  if (!make) return '';

  const { paths = [], rotate = 0, groups = [] } = make();
  const draw = list => list.map(p => (
    'string' === typeof p
      ? `<path d="${p}"/>`
      : `<path d="${p.d}" transform="${p.at || `rotate(${p.rotate})`}"/>`
  )).join('');

  /* A MARK MAY CARRY ITS OWN GROUPS. The gavel's head and handle are one
   * rigid object at an angle to the block beneath it, and rotating each
   * path on its own would need both to agree about a centre they do not
   * share. One transform on the pair is the thing that is actually true. */
  const body = draw(paths)
    + groups.map(g => `<g transform="${g.transform}">${draw(g.paths)}</g>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">`
    + `<g transform="translate(50 50) rotate(${rotate}) scale(${scale})" fill="${fill}" fill-rule="evenodd">`
    + `${body}</g></svg>`;
}

module.exports = { MARKS, FOR_TRADE, markSvg };
