// utils/localOptions/render/theme.js
//
// The stylesheet, and the class prefix that keeps the structures apart.
//
// ONE FILE PER STRUCTURE, AND EACH OWNS A PREFIX. Edwin, on seeing the
// second mock-up reuse the first one's class names: "use different structure
// and names for classes."
//
// That is not tidiness. Four layouts sharing a namespace is four stylesheets
// that cannot sit in one repository — Ledger's `<dl>` is Beacon's `<ul>`,
// Ledger's hours `<table>` is Beacon's `<dl>`, and a rule written for one
// silently restyles the other. It is the same collision the `cloudflare-` and
// `ie-` prefixes exist to prevent.
//
// SERVED AS A FILE, NOT INLINED. assets/site.css, exactly as
// utils/blog/render/theme.js does it: one request, cached across all eleven
// pages, and a page's HTML stays small enough to read.

'use strict';

/**
 * Ledger — structure 1.
 *
 * Serif headings, a hairline rule between everything, a two-column service
 * list numbered 01..06, and an hours TABLE. Quiet and documentary; the name
 * is the point.
 */
const LEDGER = {
  key: 'ledger',
  label: 'Ledger',
  prefix: 'ledger-',
  css: `:root{
  --lg-ink:#1b1a18; --lg-soft:#55514b; --lg-rule:#e2ddd4;
  --lg-paper:#faf8f5; --lg-card:#fff;
  --lg-accent:#0f5c5c; --lg-warm:#c2410c;
  --lg-gutter:clamp(1.25rem,4vw,3rem);
}
*{box-sizing:border-box}
body{margin:0;background:var(--lg-paper);color:var(--lg-ink);
  font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:Georgia,"Iowan Old Style","Times New Roman",serif;
  font-weight:600;letter-spacing:-.01em;margin:0}
a{color:var(--lg-accent)}
img{max-width:100%;display:block}
.ledger-shell{max-width:1080px;margin:0 auto;padding:0 var(--lg-gutter)}
.ledger-skip{position:absolute;left:-9999px}
.ledger-skip:focus{left:1rem;top:1rem;background:#fff;padding:.6rem 1rem;z-index:99}

/* header */
.ledger-head{background:var(--lg-card);border-bottom:1px solid var(--lg-rule);position:sticky;top:0;z-index:9}
/* 84px, RAISED WITH THE LOGO. The row's height has to be settled before the
   image loads or the header jumps as it arrives — which is why the mark
   carries no width/height attributes. A 55px logo in a 76px row left four
   pixels of air above and below it. */
.ledger-head__row{display:flex;align-items:center;gap:1.5rem;min-height:96px}
.ledger-brand{display:flex;align-items:center;gap:.7rem;margin-right:auto;text-decoration:none;color:inherit}
.ledger-brand__glyph{width:42px;height:42px;border-radius:9px;background:var(--lg-accent);color:#fff;
  display:grid;place-items:center;font-family:Georgia,serif;font-size:19px;flex:0 0 auto}
/* THE HEIGHT IS FIXED AND THE WIDTH FOLLOWS THE LOGO. A 42px SQUARE with
   object-fit:contain letterboxes a wide lockup — a 400x90 logo drew at about
   42x9 and read as a smudge — so the dimension to pin is the height.

   53px -> 70px ON 30 OCTOBER, AND THE REASON IS THE ASPECT RATIO RATHER THAN
   THE NUMBER. Pinning height suits a WIDE lockup: at 4.4:1, 53px tall comes
   out 235px wide and fills the header. Edwin's own logo is about 1.5:1, and
   at 53px tall it came out 80px wide — the rule working exactly as written,
   and a logo a third the presence of the one it was designed around.

       PINNING ONE DIMENSION SIZES ONE SHAPE WELL
       AND EVERY OTHER SHAPE BY ACCIDENT.

   max-width is what protects the wide ones: at 70px tall a 4.4:1 lockup
   wants 308px and is capped at 320, so it is unaffected. A squarer logo
   gains the whole difference. */
.ledger-brand__mark{height:70px;width:auto;max-width:min(320px,54vw);object-fit:contain;
  object-position:left center;flex:0 0 auto}
.ledger-brand__name{font-family:Georgia,serif;font-size:17px;line-height:1.2}
.ledger-brand__name small{display:block;font-family:inherit;font-size:12px;color:var(--lg-soft);
  letter-spacing:.08em;text-transform:uppercase}
.ledger-menu{display:flex;align-items:center;gap:1.5rem;font-size:15px}
.ledger-menu a{color:var(--lg-soft);text-decoration:none}
.ledger-menu a:hover,.ledger-menu a[aria-current]{color:var(--lg-accent)}

/* the services menu — a <details>, so it works with no JavaScript at all */
.ledger-drop{position:relative}
.ledger-drop>summary{list-style:none;cursor:pointer;color:var(--lg-soft);
  display:inline-flex;align-items:center;gap:.4rem;-webkit-tap-highlight-color:transparent}
.ledger-drop>summary::-webkit-details-marker{display:none}
.ledger-drop>summary::after{content:"";width:.34em;height:.34em;margin-top:-.22em;
  border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)}
.ledger-drop>summary:hover,.ledger-drop[open]>summary{color:var(--lg-accent)}
.ledger-drop[open]>summary::after{margin-top:.1em;transform:rotate(225deg)}
.ledger-drop>summary:focus-visible{outline:2px solid var(--lg-accent);outline-offset:4px;border-radius:3px}
.ledger-drop__list{position:absolute;top:calc(100% + 1.15rem);left:-1.05rem;z-index:20;
  min-width:min(264px,calc(100vw - 2.5rem));margin:0;padding:.4rem 0;list-style:none;
  background:var(--lg-card);border:1px solid var(--lg-rule);border-radius:11px;
  box-shadow:0 14px 34px rgba(20,16,10,.14)}
.ledger-drop__list li{margin:0}
.ledger-drop__list a{display:block;padding:.55rem 1.05rem;color:var(--lg-ink);font-size:15px;line-height:1.35}
.ledger-drop__list a:hover,.ledger-drop__list a:focus{background:var(--lg-paper);color:var(--lg-accent)}
.ledger-drop__list a[aria-current]{color:var(--lg-accent);font-weight:600}
.ledger-drop__all a{color:var(--lg-soft);font-size:13px;letter-spacing:.07em;text-transform:uppercase}
.ledger-ring{background:var(--lg-accent);color:#fff;text-decoration:none;font-weight:600;
  padding:.62rem 1.1rem;border-radius:8px;font-size:15px;white-space:nowrap}

/* hero */
.ledger-hero__band{height:clamp(280px,38vw,430px);overflow:hidden;background:#d9d3c9}
.ledger-hero__band img{width:100%;height:100%;object-fit:cover;object-position:center 42%}
.ledger-hero__card{background:var(--lg-card);border:1px solid var(--lg-rule);border-radius:14px;
  padding:clamp(1.5rem,4vw,2.4rem);margin-top:-78px;position:relative;max-width:760px;
  box-shadow:0 12px 30px rgba(20,16,10,.08)}
.ledger-hero__card h1{font-size:clamp(1.7rem,4.2vw,2.5rem);line-height:1.15}
.ledger-hero__card p{color:var(--lg-soft);margin:.9rem 0 1.4rem}
.ledger-acts{display:flex;gap:.7rem;flex-wrap:wrap;margin:0}
.ledger-act{display:inline-block;text-decoration:none;font-weight:600;font-size:15px;
  padding:.72rem 1.25rem;border-radius:8px}
.ledger-act--fill{background:var(--lg-warm);color:#fff}
.ledger-act--line{border:1px solid var(--lg-rule);color:var(--lg-ink)}

/* name / address / phone */
.ledger-nap{display:grid;grid-template-columns:repeat(3,1fr);margin:3rem 0 0;
  border-top:1px solid var(--lg-rule);border-bottom:1px solid var(--lg-rule)}
.ledger-nap>div{padding:1.5rem 1.6rem;border-left:1px solid var(--lg-rule)}
.ledger-nap>div:first-child{border-left:0;padding-left:0}
.ledger-nap dt{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--lg-soft);margin-bottom:.45rem}
.ledger-nap dd{margin:0;font-size:16px}
.ledger-nap dd a{text-decoration:none}

/* generic block */
.ledger-block{padding:3.4rem 0}
.ledger-block__lede{max-width:620px;margin-bottom:2rem}
.ledger-block__lede h2{font-size:clamp(1.4rem,3vw,1.85rem)}
.ledger-block__lede p{color:var(--lg-soft);margin:.6rem 0 0}

/* who we are */
.ledger-about{display:grid;grid-template-columns:.85fr 1.15fr;gap:3rem;align-items:start}
.ledger-about h2{font-size:clamp(1.35rem,2.9vw,1.8rem);line-height:1.25}
.ledger-about__text p{margin:0 0 1.1rem;color:var(--lg-soft)}
.ledger-about__text p:first-child{font-size:19px;color:var(--lg-ink)}
.ledger-about__text p:last-child{margin-bottom:0}

/* services list */
.ledger-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:0 3rem}
.ledger-list li{border-top:1px solid var(--lg-rule)}
.ledger-list a,.ledger-list__row{display:flex;gap:1rem;align-items:baseline;
  padding:1.15rem 0;text-decoration:none;color:inherit}
.ledger-list a:hover .ledger-list__name{color:var(--lg-accent)}
.ledger-list__row{color:var(--lg-soft)}
.ledger-list__row .ledger-list__name{color:var(--lg-soft)}
.ledger-list__n{font-family:Georgia,serif;font-size:13px;color:var(--lg-accent);min-width:1.6rem}
.ledger-list__name{font-family:Georgia,serif;font-size:19px;display:block}
.ledger-list__sub{display:block;font-size:14px;color:var(--lg-soft);margin-top:.15rem}

/* prose (service + legal pages) */
.ledger-prose{max-width:720px}
.ledger-prose h2{font-size:1.3rem;margin:2.4rem 0 .8rem}
.ledger-prose h2:first-child{margin-top:0}
.ledger-prose p{margin:0 0 1.05rem;color:var(--lg-soft)}
.ledger-prose p.ledger-lead{font-size:19px;color:var(--lg-ink)}
.ledger-prose ul{color:var(--lg-soft);padding-left:1.1rem}
.ledger-prose li{margin-bottom:.5rem}

/* the ring */
.ledger-onward{border-top:1px solid var(--lg-rule);margin-top:2.8rem;padding-top:1.6rem;max-width:720px}
.ledger-onward p{margin:0;color:var(--lg-soft)}

/* map + hours */
.ledger-visit{display:grid;grid-template-columns:1.15fr .85fr;gap:2.5rem;align-items:start}
.ledger-map{border:1px solid var(--lg-rule);border-radius:12px;overflow:hidden;background:#eceae5}
.ledger-map iframe{display:block;width:100%;height:360px;border:0}
.ledger-hours{background:var(--lg-card);border:1px solid var(--lg-rule);border-radius:12px;padding:1.6rem}
.ledger-hours h2{font-size:1.15rem;margin-bottom:.9rem}
.ledger-hours table{width:100%;border-collapse:collapse;font-size:15px}
.ledger-hours td{padding:.52rem 0;border-top:1px solid var(--lg-rule)}
.ledger-hours tr:first-child td{border-top:0}
.ledger-hours td:last-child{text-align:right;color:var(--lg-soft)}
.ledger-hours .ledger-shut{color:#9b958c}

/* contact */
.ledger-contact{display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:start}
.ledger-form label{display:block;font-size:13px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--lg-soft);margin:0 0 .35rem}
.ledger-form input,.ledger-form textarea{width:100%;font:inherit;font-size:16px;padding:.7rem .8rem;
  border:1px solid var(--lg-rule);border-radius:8px;background:#fff;margin-bottom:1rem}
.ledger-form textarea{min-height:140px;resize:vertical}
.ledger-form button{font:inherit;font-weight:600;font-size:15px;padding:.75rem 1.4rem;border:0;
  border-radius:8px;background:var(--lg-warm);color:#fff;cursor:pointer}
.ledger-form__note{font-size:13.5px;color:var(--lg-soft);margin:.9rem 0 0}

/* footer */
.ledger-foot{background:#123f47;color:#cfe0df;margin-top:3rem;padding:3rem 0 2rem;font-size:15px}
.ledger-foot a{color:#cfe0df;text-decoration:none}
.ledger-foot a:hover{color:#fff;text-decoration:underline}
.ledger-foot__spread{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:2.5rem}
.ledger-foot h2{font-family:Georgia,serif;color:#fff;font-size:1rem;margin:0 0 .8rem;font-weight:600}
.ledger-foot ul{list-style:none;margin:0;padding:0}
.ledger-foot li{margin-bottom:.45rem}
.ledger-foot p{margin:0;color:#9fb9b8}
.ledger-badges{display:flex;gap:.6rem;margin-top:1rem}
.ledger-badges a{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.1);
  display:grid;place-items:center}
.ledger-badges a:hover{background:rgba(255,255,255,.2)}
.ledger-badges svg{width:17px;height:17px;fill:#fff;display:block}
.ledger-foot__base{border-top:1px solid rgba(255,255,255,.14);margin-top:2.2rem;padding-top:1.3rem;
  display:flex;gap:1.4rem;flex-wrap:wrap;font-size:13.5px;color:#9fb9b8}

@media (max-width:820px){
  /* THE MENU USED TO BE display:none HERE, AND THAT IS WHY IT HAD TO GO.
   *
   * Below 820px — which is most of the traffic a local trade site gets — the
   * header had a logo and a phone button and no navigation whatsoever. The
   * footer carried everything, so nothing was unreachable, but reaching a
   * service page meant scrolling past the whole page first. There is no
   * hamburger to open because there is no JavaScript; the row wraps instead
   * and the menu sits on its own line under a hairline. */
  .ledger-head__row{flex-wrap:wrap;min-height:0;padding-top:.75rem;padding-bottom:.1rem;gap:.8rem 1.2rem}
  /* The phone button shares the top row with the logo on a narrow screen,
     so the logo gives up a little height and a lot of width. */
  .ledger-brand__mark{height:60px;max-width:min(268px,54vw)}
  .ledger-menu{order:3;flex-basis:100%;flex-wrap:wrap;gap:.4rem 1.15rem;font-size:14.5px;
    border-top:1px solid var(--lg-rule);margin-top:.15rem;padding:.65rem 0}
  .ledger-drop__list{top:calc(100% + .7rem);left:-.9rem}
  .ledger-nap{grid-template-columns:1fr}
  .ledger-nap>div{border-left:0;border-top:1px solid var(--lg-rule);padding-left:0}
  .ledger-nap>div:first-child{border-top:0}
  .ledger-list{grid-template-columns:1fr;gap:0}
  .ledger-about,.ledger-visit,.ledger-contact{grid-template-columns:1fr;gap:1.2rem}
  .ledger-foot__spread{grid-template-columns:1fr}
  .ledger-hero__card{margin-top:-50px}
}
`,
};

/**
 * Beacon — structure 2.
 *
 * BUILT 30 OCTOBER, on Edwin's "I want a different html structure, diferent
 * css and different classes and prefix and css IDs". The comment that used to
 * sit here said Beacon's markup was built and only the CSS was missing. That
 * was not true: the MOCK-UP was built. Both halves are real now.
 *
 * WHERE LEDGER IS A DOCUMENT, BEACON IS A CARD. Sans headings instead of
 * serif, a cool slate ground instead of warm paper, soft-edged panels with a
 * shadow instead of hairline rules, amber instead of teal. The services are
 * tiles rather than a numbered list, the hours a slate of rows rather than a
 * table, and the banner sets the photograph BESIDE the headline rather than
 * behind it.
 *
 * THE PREFIX IS THE WHOLE REASON THE TWO CAN COEXIST. Every selector below
 * begins `.beacon-` and every custom property `--bn-`; Ledger's `.ledger-`
 * and `--lg-` appear nowhere. Both are served as assets/site.css to
 * different sites, so a shared name is not a clash inside one file — it is a
 * rule written for one layout silently restyling the other, on a site nobody
 * happens to be looking at.
 */
const BEACON = {
  key: 'beacon',
  label: 'Beacon',
  prefix: 'beacon-',
  css: `:root{
  --bn-ink:#111822; --bn-soft:#5a6675; --bn-line:#dfe5ec;
  --bn-ground:#f3f5f8; --bn-card:#fff;
  --bn-accent:#b45309; --bn-deep:#1e3a5f;
  --bn-gutter:clamp(1.25rem,4vw,3rem);
  --bn-round:14px;
  --bn-lift:0 1px 2px rgba(17,24,34,.05),0 6px 20px rgba(17,24,34,.06);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bn-ground);color:var(--bn-ink);
  font:17px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
h1,h2,h3{font-weight:700;letter-spacing:-.021em;line-height:1.2;margin:0}
h1{font-size:clamp(2rem,4.4vw,2.9rem)}
h2{font-size:clamp(1.25rem,2.2vw,1.6rem)}
a{color:var(--bn-deep)}
img{max-width:100%;display:block}
.beacon-shell{max-width:1120px;margin:0 auto;padding:0 var(--bn-gutter)}
.beacon-flag{position:absolute;left:-9999px}
.beacon-flag:focus{left:1rem;top:1rem;background:#fff;padding:.6rem 1rem;z-index:99;border-radius:8px}

/* masthead — scrolls away, unlike Ledger's sticky bar */
.beacon-masthead{background:var(--bn-card);border-bottom:1px solid var(--bn-line)}
.beacon-masthead__row{display:flex;align-items:center;gap:1.5rem;min-height:92px}
.beacon-brand{display:flex;align-items:center;gap:.7rem;margin-right:auto;text-decoration:none;color:inherit}
/* SEE LEDGER'S NOTE ABOVE: the height is pinned, max-width protects the
   wide lockups, and 53px under-served a squarer logo badly. */
.beacon-brand__mark{height:70px;width:auto;max-width:min(320px,54vw);object-fit:contain;
  object-position:left center;flex:0 0 auto}
.beacon-brand__glyph{width:40px;height:40px;border-radius:11px;background:var(--bn-deep);color:#fff;
  display:grid;place-items:center;font-size:16px;font-weight:700;flex:0 0 auto}
.beacon-brand__name{font-size:17px;font-weight:700;letter-spacing:-.01em}
.beacon-menu{display:flex;align-items:center;gap:1.4rem;font-size:15px;font-weight:500}
.beacon-menu a{color:var(--bn-soft);text-decoration:none}
.beacon-menu a:hover,.beacon-menu a[aria-current]{color:var(--bn-accent)}

/* the services disclosure — a <details>, so it works with no JavaScript */
.beacon-trades{position:relative}
.beacon-trades>summary{list-style:none;cursor:pointer;color:var(--bn-soft);font-weight:500;
  display:inline-flex;align-items:center;gap:.4rem;-webkit-tap-highlight-color:transparent}
.beacon-trades>summary::-webkit-details-marker{display:none}
.beacon-trades>summary::after{content:"";width:.34em;height:.34em;margin-top:-.22em;
  border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;transform:rotate(45deg)}
.beacon-trades>summary:hover,.beacon-trades[open]>summary{color:var(--bn-accent)}
.beacon-trades[open]>summary::after{margin-top:.1em;transform:rotate(225deg)}
.beacon-trades>summary:focus-visible{outline:2px solid var(--bn-accent);outline-offset:4px;border-radius:4px}
.beacon-trades__list{position:absolute;top:calc(100% + 1.1rem);left:-1rem;z-index:20;
  margin:0;padding:.5rem;list-style:none;min-width:240px;
  background:var(--bn-card);border:1px solid var(--bn-line);border-radius:var(--bn-round);
  box-shadow:var(--bn-lift)}
.beacon-trades__list a{display:block;padding:.5rem .75rem;border-radius:9px;
  color:var(--bn-ink);text-decoration:none;font-size:15px}
.beacon-trades__list a:hover{background:var(--bn-ground);color:var(--bn-accent)}
.beacon-trades__all{border-bottom:1px solid var(--bn-line);margin-bottom:.35rem;padding-bottom:.35rem}
.beacon-trades__all a{font-weight:600}

/* the fact strip — Ledger has no second header row at all */
.beacon-strip{background:var(--bn-deep);color:#e8eef6}
.beacon-strip__row{display:flex;align-items:center;gap:1rem 1.75rem;flex-wrap:wrap;
  padding:.7rem 0;font-size:14.5px}
.beacon-strip__row p{margin:0}
.beacon-strip__open{color:#b9c9dd}
.beacon-ring{margin-left:auto;color:#fff;font-weight:700;text-decoration:none;
  border:1.5px solid rgba(255,255,255,.35);border-radius:999px;padding:.3rem .95rem}
.beacon-ring:hover{background:rgba(255,255,255,.12)}

/* banner — picture beside the words, never behind them */
.beacon-banner{background:var(--bn-card);border-bottom:1px solid var(--bn-line)}
.beacon-banner__row{display:grid;grid-template-columns:1fr 1fr;gap:clamp(1.5rem,4vw,3.5rem);
  align-items:center;padding-top:clamp(2.2rem,5vw,3.6rem);padding-bottom:clamp(2.2rem,5vw,3.6rem)}
.beacon-banner--bare .beacon-banner__row{grid-template-columns:1fr;max-width:46rem}
.beacon-banner__said{color:var(--bn-soft);font-size:1.07rem;margin:.9rem 0 0}
.beacon-banner__acts{display:flex;flex-wrap:wrap;gap:.7rem;margin:1.5rem 0 0}
.beacon-banner__plan img{border-radius:var(--bn-round);box-shadow:var(--bn-lift);
  aspect-ratio:3/2;object-fit:cover;width:100%;height:auto}
.beacon-act{display:inline-block;text-decoration:none;font-weight:600;font-size:15.5px;
  padding:.72rem 1.3rem;border-radius:999px;border:1.6px solid transparent}
.beacon-act--solid{background:var(--bn-accent);color:#fff}
.beacon-act--solid:hover{filter:brightness(1.08)}
.beacon-act--hollow{border-color:var(--bn-line);color:var(--bn-ink);background:var(--bn-card)}
.beacon-act--hollow:hover{border-color:var(--bn-accent);color:var(--bn-accent)}

/* preamble — three columns of facts, where Ledger has a <dl>.
   IT SITS AFTER THE ABOUT SECTION, so it has no negative margin tucking it
   under the banner any more, and it carries its own band: between two
   blocks it would otherwise inherit one's bottom padding and the other's
   top padding and float in eight rems of nothing. */
.beacon-facts{padding-bottom:clamp(2.4rem,5vw,4rem)}
.beacon-block+.beacon-facts{padding-top:0}
.beacon-facts+.beacon-block{padding-top:0}
.beacon-preamble{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;
  background:var(--bn-card);border:1px solid var(--bn-line);border-radius:var(--bn-round);
  box-shadow:var(--bn-lift);padding:1.3rem 1.5rem}
.beacon-preamble__col h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--bn-soft);font-weight:700}
.beacon-preamble__col p{margin:.35rem 0 0;font-size:15.5px}

/* blocks and prose */
.beacon-block{padding:clamp(2.4rem,5vw,4rem) 0}
/* TWO BLOCKS IN A ROW PAY THE PADDING ONCE. Ledger writes style="padding-top:0"
   into the markup of every block after the first, which is a layout decision
   living in pages.js where nobody looking at the stylesheet can see it. The
   first render of Beacon's home page had an eight-rem hole between the About
   section and the services. */
.beacon-block+.beacon-block{padding-top:0}
.beacon-block__lede{max-width:46rem;margin-bottom:1.6rem}
.beacon-block__lede p{color:var(--bn-soft);margin:.7rem 0 0}
.beacon-prose{max-width:46rem}
.beacon-prose h2{margin:2rem 0 .7rem}
.beacon-prose p{margin:0 0 1rem}
.beacon-prose ul{margin:0 0 1rem;padding-left:1.15rem}
.beacon-prose li{margin:0 0 .4rem}
.beacon-lede{font-size:1.1rem;color:var(--bn-soft)}

/* service page: the prose and the hours slate side by side */
.beacon-spread{display:grid;grid-template-columns:minmax(0,1fr) 20rem;gap:clamp(1.5rem,4vw,3rem);
  align-items:start}
.beacon-spread--solo{grid-template-columns:minmax(0,1fr)}
.beacon-aside{position:sticky;top:1.5rem}

/* tiles — Ledger's numbered list, re-thought */
.beacon-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;list-style:none;margin:0;padding:0}
.beacon-trade>a,.beacon-trade>span{display:block;height:100%;text-decoration:none;color:inherit;
  background:var(--bn-card);border:1px solid var(--bn-line);border-radius:var(--bn-round);
  padding:1.25rem 1.35rem;box-shadow:var(--bn-lift)}
.beacon-trade>a:hover{border-color:var(--bn-accent);transform:translateY(-2px);transition:.15s}
.beacon-trade__tally{display:block;font-size:12px;font-weight:700;letter-spacing:.1em;
  color:var(--bn-accent)}
.beacon-trade__name{display:block;font-weight:700;font-size:1.05rem;margin:.45rem 0 .3rem}
.beacon-trade__said{display:block;color:var(--bn-soft);font-size:14.5px;line-height:1.5}
/* A TILE THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
   NOT. The last three services are shown and unlinked — the ring caps the
   body at three — so they are visibly muted rather than quietly inert. */
.beacon-trade--flat>span{opacity:.62;box-shadow:none}

/* hours and map */
.beacon-whereabouts{display:grid;grid-template-columns:minmax(0,1fr) 20rem;gap:clamp(1.5rem,4vw,3rem);
  align-items:start}
.beacon-plan iframe{width:100%;height:340px;border:0;border-radius:var(--bn-round);
  box-shadow:var(--bn-lift);display:block}
.beacon-slate{background:var(--bn-card);border:1px solid var(--bn-line);border-radius:var(--bn-round);
  box-shadow:var(--bn-lift);padding:1.2rem 1.35rem}
.beacon-slate h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--bn-soft);
  margin-bottom:.7rem}
.beacon-slate__row{display:flex;justify-content:space-between;gap:1rem;
  padding:.42rem 0;font-size:15px;border-top:1px solid var(--bn-line)}
.beacon-slate__row:first-of-type{border-top:0}
.beacon-slate--shut{color:var(--bn-soft)}
.beacon-slate__note{margin:.9rem 0 0;font-size:13.5px;color:var(--bn-soft)}

/* the dividers — a breather between bands, not a section heading.
   THE DEEP GROUND IS THE POINT: every other band on the home page is white
   or near-white, so a line of the same colour would read as another
   section rather than as the gap between two. */
.beacon-divider{background:var(--bn-deep);color:#fff;
  padding:clamp(1.8rem,3.5vw,2.8rem) 0}
.beacon-divider p{margin:0;text-align:center;font-weight:600;
  font-size:clamp(1.15rem,2.4vw,1.5rem);letter-spacing:-.015em;
  max-width:34rem;margin-inline:auto;text-wrap:balance}
/* A BLOCK EITHER SIDE OF IT KEEPS ITS OWN PADDING. The +.beacon-block rule
   above strips the top padding of whatever follows a block, and a divider
   between two of them is exactly where that strip must not apply — the band
   needs air under it. */
.beacon-divider+.beacon-block{padding-top:clamp(2.4rem,5vw,4rem)}

/* the ring sentence */
.beacon-kicker{margin:2.4rem 0 0;padding-top:1.3rem;border-top:1px solid var(--bn-line);
  color:var(--bn-soft);font-size:15.5px}

/* the contact form */
.beacon-form{background:var(--bn-card);border:1px solid var(--bn-line);border-radius:var(--bn-round);
  box-shadow:var(--bn-lift);padding:1.5rem}
.beacon-form label{display:block;font-size:13px;font-weight:700;letter-spacing:.04em;
  text-transform:uppercase;color:var(--bn-soft);margin:1rem 0 .35rem}
.beacon-form label:first-child{margin-top:0}
.beacon-form input,.beacon-form textarea{width:100%;font:inherit;font-size:16px;color:inherit;
  background:var(--bn-ground);border:1px solid var(--bn-line);border-radius:10px;padding:.65rem .8rem}
.beacon-form textarea{min-height:8rem;resize:vertical}
.beacon-form input:focus,.beacon-form textarea:focus{outline:2px solid var(--bn-accent);outline-offset:1px}
.beacon-form button{margin-top:1.3rem;font:inherit;font-weight:700;font-size:15.5px;cursor:pointer;
  background:var(--bn-accent);color:#fff;border:0;border-radius:999px;padding:.75rem 1.5rem}
.beacon-form__note{margin:1rem 0 0;font-size:14px;color:var(--bn-soft)}

/* colophon */
.beacon-colophon{background:var(--bn-deep);color:#cdd9e7;padding:clamp(2.2rem,4vw,3.2rem) 0 1.4rem}
.beacon-colophon a{color:#fff;text-decoration:none}
.beacon-colophon a:hover{color:var(--bn-accent)}
.beacon-colophon__spread{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:1.8rem}
.beacon-colophon__title{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#8fa6c0}
.beacon-colophon p{margin:.7rem 0 0;font-size:15px;line-height:1.6}
.beacon-colophon ul{list-style:none;margin:.7rem 0 0;padding:0;font-size:15px}
.beacon-colophon li{margin:0 0 .4rem}
.beacon-badges{display:flex;gap:.65rem}
.beacon-badges svg{width:19px;height:19px;fill:#8fa6c0}
.beacon-badges a:hover svg{fill:#fff}
.beacon-colophon__foot{display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;margin-top:2rem;
  padding-top:1.2rem;border-top:1px solid rgba(255,255,255,.14);font-size:13.5px;color:#8fa6c0}

@media (max-width:860px){
  .beacon-banner__row{grid-template-columns:1fr}
  /* THE WORDS FIRST ON A PHONE, so the H1 and the Call button are on screen
     without scrolling — section 1 of the ratified service-page shape. */
  .beacon-banner__plan{order:2}
  .beacon-preamble{grid-template-columns:1fr}
  .beacon-spread,.beacon-whereabouts{grid-template-columns:1fr}
  .beacon-aside{position:static}
  .beacon-tiles{grid-template-columns:1fr 1fr}
  .beacon-colophon__spread{grid-template-columns:1fr}
}

@media (max-width:620px){
  /* THE ROW WRAPS RATHER THAN COLLAPSING INTO A HAMBURGER, because these
     sites ship no JavaScript to open one with. */
  .beacon-masthead__row{flex-wrap:wrap;min-height:0;padding:.75rem 0 .1rem;gap:.8rem 1.2rem}
  .beacon-brand__mark{height:60px;max-width:min(268px,54vw)}
  .beacon-menu{order:3;flex-basis:100%;flex-wrap:wrap;gap:.4rem 1.1rem;font-size:14.5px;
    border-top:1px solid var(--bn-line);margin-top:.15rem;padding:.65rem 0}
  .beacon-trades__list{top:calc(100% + .7rem);left:-.9rem}
  .beacon-ring{margin-left:0}
  .beacon-tiles{grid-template-columns:1fr}
}
`,
};

/**
 * Anvil — the dark one.
 *
 * ASKED FOR ON 31 OCTOBER: "a more darker version", with its own structure,
 * css, classes, prefix, ids and prompts. Dark throughout rather than a dark
 * masthead over a light body, which was the alternative and would have read
 * as a variation on Ledger rather than as a third design.
 *
 * THE PREFIX IS WHY THREE CAN COEXIST. Every selector below begins `.anvil-`
 * and every custom property `--av-`. Ledger's `--lg-` and Beacon's `--bn-`
 * appear nowhere. All three are served as assets/site.css to different sites,
 * so a shared name is not a clash inside one file — it is a rule written for
 * one layout silently restyling another, on a site nobody is looking at.
 *
 * WHAT A DARK PAGE COSTS, AND WHERE IT IS PAID
 *
 *   contrast   Body text is #e7ecf3 on #11151c, not #fff on #000. Pure white
 *              on pure black is the pairing that makes long text shimmer;
 *              both ends are pulled in.
 *   the logo   An owner's logo is dark ink on transparency as often as not,
 *              so the mark sits on a light plate. See chrome.js — the rule is
 *              unconditional because nothing here can see inside a PNG.
 *   the photo  A bright photograph on a dark page is a lightbox. The stage
 *              carries a gradient scrim, and the words sit on top of it.
 *   the rules  A hairline that reads on white disappears on near-black. Every
 *              border here is a light at low alpha rather than a dark grey,
 *              which is the only thing that separates two dark surfaces.
 *   dividers   Beacon's break is a DEEP band among light ones. Inverted here:
 *              a RAISED band among dark ones. A dark band on a dark page is
 *              not a break, it is a gap.
 */
const ANVIL = {
  key: 'anvil',
  label: 'Anvil',
  prefix: 'anvil-',
  css: `:root{
  --av-ink:#e7ecf3; --av-soft:#9aa7b8; --av-dim:#76839660;
  --av-ground:#11151c; --av-raise:#1a212b; --av-lift:#222b38;
  --av-line:rgba(255,255,255,.1); --av-edge:rgba(255,255,255,.18);
  --av-accent:#f59e0b; --av-accent-ink:#1a1206;
  --av-gutter:clamp(1.25rem,4vw,3rem);
  --av-round:6px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--av-ground);color:var(--av-ink);
  font:17px/1.65 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
h1,h2,h3{font-weight:700;letter-spacing:-.02em;line-height:1.18;margin:0}
h1{font-size:clamp(2.1rem,4.8vw,3.2rem)}
h2{font-size:clamp(1.3rem,2.3vw,1.7rem)}
a{color:var(--av-accent)}
img{max-width:100%;display:block}
.anvil-shell{max-width:1120px;margin:0 auto;padding:0 var(--av-gutter)}
.anvil-skip{position:absolute;left:-9999px}
.anvil-skip:focus{left:1rem;top:1rem;background:var(--av-accent);color:var(--av-accent-ink);
  padding:.6rem 1rem;z-index:99;border-radius:var(--av-round)}

/* the rail — ONE row, not sticky. Beacon has two bands before the page
   starts; Ledger's single bar is sticky. This is neither. */
.anvil-rail{background:var(--av-raise);border-bottom:1px solid var(--av-line)}
.anvil-rail__row{display:flex;align-items:center;gap:1.5rem;min-height:88px}
.anvil-brand{display:flex;align-items:center;gap:.75rem;margin-right:auto;
  text-decoration:none;color:inherit}
/* THE LIGHT PLATE IS THE DARK-PAGE TAX ON LOGOS. A wordmark drawn in dark
   ink on transparency is invisible on this rail, and no rule here can look
   inside the file to find out whether this one is. Every logo gets the
   plate: a visible logo that could have been prettier beats an invisible
   one. The height matches Ledger's and Beacon's 70px so the same upload
   looks the same size in all three. */
.anvil-brand__plate{display:inline-flex;align-items:center;background:#fff;
  border-radius:var(--av-round);padding:.45rem .6rem;flex:0 0 auto}
.anvil-brand__mark{height:70px;width:auto;max-width:min(320px,54vw);object-fit:contain;
  object-position:left center}
.anvil-brand__glyph{width:42px;height:42px;border-radius:var(--av-round);
  background:var(--av-accent);color:var(--av-accent-ink);
  display:grid;place-items:center;font-size:16px;font-weight:800;flex:0 0 auto}
.anvil-brand__name{font-size:17px;font-weight:700;letter-spacing:-.01em}
.anvil-nav{display:flex;align-items:center;gap:1.4rem;font-size:15px;font-weight:500}
.anvil-nav a{color:var(--av-soft);text-decoration:none}
.anvil-nav a:hover,.anvil-nav a[aria-current]{color:var(--av-ink)}
.anvil-dial{background:var(--av-accent);color:var(--av-accent-ink);font-weight:700;
  text-decoration:none;font-size:15px;padding:.6rem 1.1rem;border-radius:var(--av-round);
  white-space:nowrap}
.anvil-dial:hover{filter:brightness(1.08)}

/* the services disclosure — a <details>, so it works with no JavaScript */
.anvil-work{position:relative}
.anvil-work>summary{list-style:none;cursor:pointer;color:var(--av-soft);font-weight:500;
  display:inline-flex;align-items:center;gap:.4rem;-webkit-tap-highlight-color:transparent}
.anvil-work>summary::-webkit-details-marker{display:none}
.anvil-work>summary::after{content:"";width:.34em;height:.34em;margin-top:-.22em;
  border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;transform:rotate(45deg)}
.anvil-work>summary:hover,.anvil-work[open]>summary{color:var(--av-ink)}
.anvil-work[open]>summary::after{margin-top:.1em;transform:rotate(225deg)}
.anvil-work>summary:focus-visible{outline:2px solid var(--av-accent);outline-offset:4px;border-radius:4px}
.anvil-work__list{position:absolute;top:calc(100% + 1.1rem);left:-1rem;z-index:20;
  margin:0;padding:.4rem;list-style:none;min-width:240px;
  background:var(--av-lift);border:1px solid var(--av-edge);border-radius:var(--av-round);
  box-shadow:0 18px 40px rgba(0,0,0,.5)}
.anvil-work__list a{display:block;padding:.5rem .75rem;border-radius:4px;
  color:var(--av-ink);text-decoration:none;font-size:15px}
.anvil-work__list a:hover{background:var(--av-raise);color:var(--av-accent)}
.anvil-work__all{border-bottom:1px solid var(--av-line);margin-bottom:.35rem;padding-bottom:.35rem}
.anvil-work__all a{font-weight:600}

/* the stage — words ON the photograph, which only reads well dark.
   THE SCRIM IS A PSEUDO-ELEMENT, not a change to the image: the same four
   files serve all three structures, and darkening them would mean a fourth
   variant of every photograph and a build step to make it.
   TWO STOPS, NOT ONE. A flat wash over the whole picture flattens it; a
   gradient weighted to the bottom-left keeps the image readable where there
   are no words and buries it where there are. */
.anvil-stage{position:relative;isolation:isolate;background:var(--av-raise);
  min-height:clamp(26rem,52vw,34rem);display:flex;align-items:flex-end}
.anvil-stage__shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
.anvil-stage::after{content:"";position:absolute;inset:0;z-index:-1;
  background:linear-gradient(to top,rgba(10,13,18,.94) 0%,rgba(10,13,18,.78) 38%,rgba(10,13,18,.35) 72%,rgba(10,13,18,.2) 100%)}
.anvil-stage--bare{min-height:0}
.anvil-stage--bare::after{display:none}
.anvil-stage__words{padding-top:clamp(3rem,8vw,6rem);padding-bottom:clamp(2.2rem,5vw,3.4rem);
  max-width:min(100%,62rem);width:100%}
.anvil-stage__words h1{text-wrap:balance}
.anvil-stage__said{color:#cfd8e4;font-size:1.1rem;margin:1rem 0 0;max-width:40rem}
.anvil-stage__acts{display:flex;flex-wrap:wrap;gap:.7rem;margin:1.7rem 0 0}
.anvil-act{display:inline-block;text-decoration:none;font-weight:700;font-size:15.5px;
  padding:.78rem 1.4rem;border-radius:var(--av-round);border:1.6px solid transparent}
.anvil-act--solid{background:var(--av-accent);color:var(--av-accent-ink)}
.anvil-act--solid:hover{filter:brightness(1.08)}
/* A GHOST BUTTON ON A PHOTOGRAPH NEEDS ITS OWN GROUND. Transparent over an
   image is a rectangle of whatever happens to be behind it; the faint fill
   plus the blur keeps the label legible over a bright patch. */
.anvil-act--ghost{border-color:var(--av-edge);color:#fff;background:rgba(255,255,255,.08);
  backdrop-filter:blur(3px)}
.anvil-act--ghost:hover{border-color:#fff;background:rgba(255,255,255,.16)}

/* the plate — facts inline on one rule, where Ledger has a <dl> and Beacon
   has three columns in a card */
.anvil-facts{padding:clamp(1.6rem,3vw,2.2rem) 0 0}
.anvil-plate{display:grid;grid-template-columns:repeat(3,1fr);
  border-top:1px solid var(--av-line);border-bottom:1px solid var(--av-line)}
.anvil-plate__cell{padding:1.1rem 1.4rem}
.anvil-plate__cell+.anvil-plate__cell{border-left:1px solid var(--av-line)}
.anvil-plate__cell:first-child{padding-left:0}
.anvil-plate__cell span{display:block;font-size:11.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--av-soft);font-weight:700}
.anvil-plate__cell p{margin:.4rem 0 0;font-size:15.5px}
.anvil-plate__cell a{color:var(--av-ink);text-decoration:none}
.anvil-plate__cell a:hover{color:var(--av-accent)}

/* bands and prose */
.anvil-band{padding:clamp(2.6rem,5vw,4.2rem) 0}
/* TWO BANDS IN A ROW PAY THE PADDING ONCE — the rule Beacon had to add after
   its home page opened an eight-rem hole between About and the services.
   Written in the stylesheet, not as inline style in pages.js, so somebody
   reading the CSS can see the layout decision. */
.anvil-band+.anvil-band{padding-top:0}
.anvil-facts+.anvil-band{padding-top:clamp(2.6rem,5vw,4.2rem)}
.anvil-band__lede{max-width:46rem;margin-bottom:1.8rem}
.anvil-band__lede p{color:var(--av-soft);margin:.7rem 0 0}
.anvil-prose{max-width:46rem}
.anvil-prose h2{margin:2.1rem 0 .7rem}
.anvil-prose p{margin:0 0 1rem}
.anvil-prose ul{margin:0 0 1rem;padding-left:1.15rem}
.anvil-prose li{margin:0 0 .45rem}
.anvil-lede{font-size:1.12rem;color:#c3cdda}

/* the ladder — full-width rungs, where Ledger numbers two columns and
   Beacon lays out three-up tiles */
.anvil-ladder{list-style:none;margin:0;padding:0;border-top:1px solid var(--av-line)}
.anvil-rung>a,.anvil-rung>span{display:grid;grid-template-columns:4rem 16rem minmax(0,1fr);
  gap:1.5rem;align-items:baseline;padding:1.35rem .25rem;
  border-bottom:1px solid var(--av-line);text-decoration:none;color:inherit}
.anvil-rung>a:hover{background:var(--av-raise)}
.anvil-rung>a:hover .anvil-rung__name{color:var(--av-accent)}
.anvil-rung__tally{font-size:13px;font-weight:800;letter-spacing:.1em;color:var(--av-accent)}
.anvil-rung__name{font-weight:700;font-size:1.1rem}
.anvil-rung__said{color:var(--av-soft);font-size:15px;line-height:1.55}
/* A ROW THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
   NOT. The services past the body cap are shown and unlinked, so they are
   visibly muted rather than quietly inert. */
.anvil-rung--flat>span{opacity:.5}

/* the hours — seven days ACROSS, under the prose, full width */
.anvil-watch{margin:2.6rem 0 0;border:1px solid var(--av-line);border-radius:var(--av-round);
  background:var(--av-raise);padding:1.3rem 1.5rem}
.anvil-watch h2{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--av-soft);margin-bottom:1rem}
.anvil-watch__row{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;
  background:var(--av-line);border:1px solid var(--av-line);border-radius:4px;overflow:hidden}
.anvil-watch__day{background:var(--av-lift);padding:.8rem .5rem;text-align:center}
.anvil-watch__day span{display:block;font-size:11.5px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--av-soft)}
.anvil-watch__day strong{display:block;margin-top:.35rem;font-size:14px;font-weight:600}
.anvil-watch--shut strong{color:var(--av-soft);font-weight:400}
.anvil-watch__note{margin:1rem 0 0;font-size:13.5px;color:var(--av-soft)}

/* the map */
.anvil-map iframe{width:100%;height:380px;border:0;border-radius:var(--av-round);
  display:block;filter:grayscale(.3) contrast(1.05) brightness(.92)}

/* the break — RAISED, not deep. Beacon's divider is the dark band among
   light ones; on a dark page the same job needs the opposite move. */
.anvil-break{background:var(--av-raise);border-top:1px solid var(--av-line);
  border-bottom:1px solid var(--av-line);padding:clamp(2rem,3.6vw,3rem) 0}
.anvil-break p{margin:0;text-align:center;font-weight:600;color:#fff;
  font-size:clamp(1.15rem,2.4vw,1.5rem);letter-spacing:-.015em;
  max-width:34rem;margin-inline:auto;text-wrap:balance}
/* A BAND EITHER SIDE KEEPS ITS OWN PADDING. The +.anvil-band rule above
   strips the top padding of whatever follows a band, and a break between two
   of them is exactly where that strip must not apply. */
.anvil-break+.anvil-band{padding-top:clamp(2.6rem,5vw,4.2rem)}

/* the ring sentence */
.anvil-onward{margin:2.6rem 0 0;padding-top:1.4rem;border-top:1px solid var(--av-line);
  color:var(--av-soft);font-size:15.5px}

/* the contact form — full width, facts in three columns beneath */
.anvil-form{background:var(--av-raise);border:1px solid var(--av-line);
  border-radius:var(--av-round);padding:1.7rem;max-width:46rem}
.anvil-form__pair{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}
.anvil-form label{display:block;font-size:12.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--av-soft);margin:1.1rem 0 .4rem}
.anvil-form__pair label{margin-top:0}
.anvil-form input,.anvil-form textarea{width:100%;font:inherit;font-size:16px;color:var(--av-ink);
  background:var(--av-ground);border:1px solid var(--av-edge);border-radius:4px;padding:.7rem .85rem}
.anvil-form textarea{min-height:8rem;resize:vertical}
.anvil-form input:focus,.anvil-form textarea:focus{outline:2px solid var(--av-accent);outline-offset:1px}
.anvil-form button{margin-top:1.4rem;font:inherit;font-weight:700;font-size:15.5px;cursor:pointer;
  background:var(--av-accent);color:var(--av-accent-ink);border:0;
  border-radius:var(--av-round);padding:.8rem 1.6rem}
.anvil-form__note{margin:1.1rem 0 0;font-size:14px;color:var(--av-soft)}
.anvil-threes{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(1.5rem,3vw,2.5rem);
  margin-top:2.8rem}
.anvil-threes h2{font-size:1.05rem;margin:0 0 .6rem}

/* colophon */
.anvil-colophon{background:#0b0e13;border-top:1px solid var(--av-line);
  color:var(--av-soft);padding:clamp(2.4rem,4vw,3.4rem) 0 1.5rem}
.anvil-colophon a{color:var(--av-ink);text-decoration:none}
.anvil-colophon a:hover{color:var(--av-accent)}
.anvil-colophon__spread{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:1.8rem}
.anvil-colophon__title{font-size:12px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--av-soft)}
.anvil-colophon p{margin:.75rem 0 0;font-size:15px;line-height:1.6}
.anvil-colophon ul{list-style:none;margin:.75rem 0 0;padding:0;font-size:15px}
.anvil-colophon li{margin:0 0 .45rem}
.anvil-marks{display:flex;gap:.7rem}
.anvil-marks svg{width:19px;height:19px;fill:var(--av-soft)}
.anvil-marks a:hover svg{fill:var(--av-accent)}
.anvil-colophon__foot{display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;margin-top:2.2rem;
  padding-top:1.3rem;border-top:1px solid var(--av-line);font-size:13.5px}

@media (max-width:900px){
  .anvil-rung>a,.anvil-rung>span{grid-template-columns:3rem minmax(0,1fr);gap:.4rem 1rem}
  .anvil-rung__said{grid-column:2}
  .anvil-threes{grid-template-columns:1fr}
  .anvil-colophon__spread{grid-template-columns:1fr}
  /* SEVEN COLUMNS DO NOT FIT A TABLET. Four then three reads as a calendar
     rather than as a squeezed row of unreadable stubs. */
  .anvil-watch__row{grid-template-columns:repeat(4,1fr)}
}

@media (max-width:620px){
  /* THE ROW WRAPS RATHER THAN COLLAPSING INTO A HAMBURGER, because these
     sites ship no JavaScript to open one with. The number goes first so it
     is reachable with a thumb before anything else. */
  .anvil-rail__row{flex-wrap:wrap;min-height:0;padding:.8rem 0 .2rem;gap:.7rem 1.1rem}
  .anvil-brand__mark{height:56px;max-width:min(240px,50vw)}
  .anvil-dial{order:2;margin-left:auto}
  .anvil-nav{order:3;flex-basis:100%;flex-wrap:wrap;gap:.4rem 1.1rem;font-size:14.5px;
    border-top:1px solid var(--av-line);margin-top:.2rem;padding:.7rem 0}
  .anvil-work__list{top:calc(100% + .7rem);left:-.9rem}
  .anvil-stage{min-height:0}
  .anvil-stage__words{padding-top:clamp(2.4rem,9vw,3.4rem)}
  .anvil-plate{grid-template-columns:1fr}
  .anvil-plate__cell{padding-left:0}
  .anvil-plate__cell+.anvil-plate__cell{border-left:0;border-top:1px solid var(--av-line)}
  .anvil-watch__row{grid-template-columns:repeat(2,1fr)}
  .anvil-form__pair{grid-template-columns:1fr}
}
`,
};

/**
 * Quarry — the stone one.
 *
 * THE FOURTH, AND THE FIRST WRITTEN MOBILE FIRST. Ledger, Beacon and Anvil
 * are all one wide layout with `max-width` queries subtracting from it. Every
 * one of them therefore DESCRIBES the phone as an exception, and the phone is
 * where these sites are read. This block states the narrow layout plainly and
 * adds columns at `min-width`, which is both Edwin's standing rule and the
 * reason the mobile rules here are shorter than the desktop ones.
 *
 * THE PREFIX IS WHY FOUR CAN COEXIST. Every selector below begins `.quarry-`
 * and every custom property `--qy-`. Ledger's `--lg-`, Beacon's `--bn-` and
 * Anvil's `--av-` appear nowhere. All four are served as assets/site.css to
 * different sites, so a shared name is not a clash inside one file — it is a
 * rule written for one layout silently restyling another, on a site nobody is
 * looking at.
 *
 * WHAT MAKES IT A FOURTH DESIGN RATHER THAN A RECOLOUR
 *
 *   corners    Nothing is rounded. Beacon is built on its radius and Anvil
 *              carries 6px everywhere; this has no --qy-round to set.
 *   rules      The band separators are 2px in ink, not hairlines. On a stone
 *              ground a hairline reads as a smudge, and the heavy rule is
 *              what makes the page look set rather than laid out.
 *   type       One grotesque at 800, tracked tight, with the LABELS in
 *              11px uppercase. Ledger's headings are Georgia and Beacon's
 *              and Anvil's are the body sans at 700 — none of the three
 *              uses weight this heavy or labels this small.
 *   colour     Moss on stone. Ledger is teal on warm paper, Beacon blue on
 *              near-white, Anvil amber on near-black.
 *   the index  A sticky column of names beside the blurbs, which is the one
 *              piece of layout here that no other structure has anything
 *              like. Everything else is a different answer to a question all
 *              four were asked; this is a different question.
 *
 * NO DARK-MODE BLOCK, like the other three. A `prefers-color-scheme` section
 * would be a fifth palette maintained by nobody, and the page already states
 * its own ground on `body` so a dark-mode browser does not invent one.
 */
const QUARRY = {
  key: 'quarry',
  label: 'Quarry',
  prefix: 'quarry-',
  css: `:root{
  --qy-ink:#1c1e1a; --qy-soft:#595f54; --qy-rule:#1c1e1a;
  --qy-hair:#d3d0c7; --qy-ground:#ecebe5; --qy-raise:#f6f5f1; --qy-card:#fff;
  --qy-accent:#3f5231; --qy-accent-ink:#fff;
  --qy-gutter:clamp(1.1rem,5vw,3rem);
  --qy-stack:clamp(2.2rem,6vw,3.6rem);
}
*{box-sizing:border-box}
body{margin:0;background:var(--qy-ground);color:var(--qy-ink);
  font:17px/1.66 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
h1,h2,h3{font-weight:800;letter-spacing:-.03em;line-height:1.12;margin:0}
h1{font-size:clamp(2.2rem,8vw,4rem)}
h2{font-size:clamp(1.35rem,3.4vw,1.9rem)}
h3{font-size:1.1rem}
a{color:var(--qy-accent)}
img{max-width:100%;display:block}
.quarry-shell{max-width:1140px;margin:0 auto;padding:0 var(--qy-gutter)}
.quarry-skip{position:absolute;left:-9999px}
.quarry-skip:focus{left:1rem;top:1rem;background:var(--qy-accent);color:var(--qy-accent-ink);
  padding:.6rem 1rem;z-index:99}

/* the bar — TWO ROWS, and on a phone that is the point: the name and the
   number first, the links on their own line under them, with nothing
   competing for the same 360px. Not sticky, so the H1 gets the whole screen
   on the first scroll. */
.quarry-bar{background:var(--qy-raise);border-bottom:2px solid var(--qy-rule)}
.quarry-bar__row{display:flex;align-items:center;gap:1rem;
  padding-top:.85rem;padding-bottom:.85rem}
.quarry-brand{display:flex;align-items:center;gap:.7rem;margin-right:auto;
  text-decoration:none;color:inherit;min-width:0}
/* NO PLATE BEHIND THE MARK. See chrome.js: this is a light bar, so a logo
   drawn in dark ink on transparency is the normal case rather than the
   problem Anvil has to work around. The height matches the other three so
   the same upload looks the same size whichever layout it lands in. */
.quarry-brand__mark{height:54px;width:auto;max-width:min(240px,48vw);object-fit:contain;
  object-position:left center}
.quarry-brand__glyph{width:42px;height:42px;background:var(--qy-accent);
  color:var(--qy-accent-ink);display:grid;place-items:center;
  font-size:15px;font-weight:800;letter-spacing:.02em;flex:0 0 auto}
.quarry-brand__name{font-size:16.5px;font-weight:800;letter-spacing:-.02em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* THE NUMBER IS A BLOCK ON A PHONE AND NEVER WRAPS. A call button that
   breaks across two lines is the one control on the page that has to be hit
   first time. */
.quarry-dial{background:var(--qy-accent);color:var(--qy-accent-ink);font-weight:800;
  text-decoration:none;font-size:15px;padding:.6rem 1rem;white-space:nowrap;flex:0 0 auto}
.quarry-dial:hover{background:#344527}
.quarry-nav{border-top:1px solid var(--qy-hair);font-size:15px;font-weight:600}
.quarry-nav__row{display:flex;align-items:center;flex-wrap:wrap;gap:.3rem 1.3rem;
  padding-top:.6rem;padding-bottom:.6rem}
.quarry-nav a{color:var(--qy-soft);text-decoration:none}
.quarry-nav a:hover,.quarry-nav a[aria-current]{color:var(--qy-ink)}

/* the services disclosure — a <details>, so it works with no JavaScript */
.quarry-menu{position:relative}
.quarry-menu>summary{list-style:none;cursor:pointer;color:var(--qy-soft);font-weight:600;
  display:inline-flex;align-items:center;gap:.4rem;-webkit-tap-highlight-color:transparent}
.quarry-menu>summary::-webkit-details-marker{display:none}
.quarry-menu>summary::after{content:"";width:.34em;height:.34em;margin-top:-.22em;
  border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;transform:rotate(45deg)}
.quarry-menu>summary:hover,.quarry-menu[open]>summary{color:var(--qy-ink)}
.quarry-menu[open]>summary::after{margin-top:.1em;transform:rotate(225deg)}
.quarry-menu>summary:focus-visible{outline:2px solid var(--qy-accent);outline-offset:4px}
/* STATIC ON A PHONE, DROPPED ON A DESKTOP. An absolutely-positioned panel in
   a 360px column is a panel with its right half off the screen; here it
   simply pushes the row down, which is what a disclosure is for. */
.quarry-menu__list{margin:.6rem 0 .2rem;padding:0;list-style:none;
  border-top:1px solid var(--qy-hair);border-bottom:1px solid var(--qy-hair)}
.quarry-menu__list a{display:block;padding:.55rem 0;color:var(--qy-ink);
  text-decoration:none;font-size:15px;font-weight:500}
.quarry-menu__list a:hover{color:var(--qy-accent)}
.quarry-menu__all a{font-weight:800}

/* the masthead — TYPE FIRST, no picture. The inversion the whole structure
   is built on; see the note at the top of quarry/chrome.js. */
.quarry-masthead{padding:var(--qy-stack) 0 clamp(1.6rem,4vw,2.4rem)}
.quarry-masthead__line{text-wrap:balance;max-width:34ch}
.quarry-masthead__said{color:var(--qy-soft);font-size:clamp(1.05rem,2.6vw,1.2rem);
  margin:1.1rem 0 0;max-width:46ch}
.quarry-masthead__acts{display:flex;flex-wrap:wrap;gap:.6rem;margin:1.6rem 0 0}
.quarry-act{display:inline-block;text-decoration:none;font-weight:800;font-size:15.5px;
  padding:.8rem 1.3rem;border:2px solid var(--qy-rule)}
.quarry-act--solid{background:var(--qy-accent);border-color:var(--qy-accent);
  color:var(--qy-accent-ink)}
.quarry-act--solid:hover{background:#344527;border-color:#344527}
.quarry-act--plain{background:transparent;color:var(--qy-ink)}
.quarry-act--plain:hover{background:var(--qy-ink);color:var(--qy-raise)}

/* the seam — the photograph, full bleed, SHORT. A band the page passes
   through rather than a hero: the hero was the headline. */
.quarry-seam{margin:0;background:var(--qy-hair);
  border-top:2px solid var(--qy-rule);border-bottom:2px solid var(--qy-rule)}
/* THE CROP SITS ABOVE CENTRE, AND FOUR HEADLESS PLUMBERS ARE WHY.
   The band shows about half the frame. Trade photography puts the person in
   the top third and their hands in the bottom third, so a centred crop takes
   the strip between the two: every subject cut off at the jaw, on every page
   of the site. Edwin saw all four of set-4 that way on 17 November and chose
   the faces.
   IT IS A CHOICE, NOT A FIX. The subject spans the whole frame, so you keep
   the faces or you keep the wrench; a band tall enough for both is a hero,
   which is the one thing this structure is defined against. */
.quarry-seam__shot{width:100%;height:clamp(13rem,42vw,22rem);object-fit:cover;
  object-position:50% 12%}

/* the kerb — three stacked rows, label above value */
.quarry-facts{padding:clamp(1.6rem,4vw,2.4rem) 0 0}
.quarry-kerb{margin:0;display:grid;gap:1.1rem}
.quarry-kerb dt{font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  font-weight:800;color:var(--qy-soft)}
.quarry-kerb dd{margin:.3rem 0 0;font-size:16px;font-weight:600}
.quarry-kerb a{color:var(--qy-ink);text-decoration:none}
.quarry-kerb a:hover{color:var(--qy-accent)}

/* bands and prose */
.quarry-band{padding:var(--qy-stack) 0}
/* TWO BANDS IN A ROW PAY THE PADDING ONCE — the rule Beacon had to add after
   its home page opened an eight-rem hole between About and the services, and
   Anvil carries it too. Written in the stylesheet rather than as inline
   style in pages.js, so somebody reading the CSS can see the decision. */
.quarry-band+.quarry-band{padding-top:0}
.quarry-facts+.quarry-band{padding-top:var(--qy-stack)}
.quarry-band__lede{max-width:48rem;margin-bottom:1.6rem}
.quarry-band__lede p{color:var(--qy-soft);margin:.7rem 0 0}
.quarry-prose{max-width:46rem}
.quarry-prose h2{margin:2rem 0 .7rem}
.quarry-prose p{margin:0 0 1rem}
.quarry-prose ul{margin:0 0 1rem;padding-left:1.1rem}
.quarry-prose li{margin:0 0 .45rem}
.quarry-lede{font-size:1.14rem;color:#36392f}

/* the index — the one piece of layout no other structure has anything like.
   ONE COLUMN ON A PHONE, where a sticky list beside a scrolling one is two
   things fighting for the same 360px: the names collapse away and the blurbs
   carry their own numbers, which is why told__tally exists. */
.quarry-index{display:grid;gap:1.4rem}
.quarry-index__col{display:none}
.quarry-index__list{margin:0;padding:0;list-style:none}
.quarry-index__row{border-top:1px solid var(--qy-hair)}
.quarry-index__row:last-child{border-bottom:1px solid var(--qy-hair)}
.quarry-index__row a,.quarry-index__row>span{display:flex;gap:.9rem;align-items:baseline;
  padding:.7rem 0;text-decoration:none;color:inherit}
.quarry-index__row a:hover .quarry-index__name{color:var(--qy-accent)}
.quarry-index__tally{font-size:11.5px;font-weight:800;letter-spacing:.1em;
  color:var(--qy-accent);flex:0 0 auto}
.quarry-index__name{font-weight:700;font-size:16px}
/* A ROW THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
   NOT. The services past the body cap are shown and unlinked, so they are
   visibly muted rather than quietly inert. */
.quarry-index__row--flat>span{opacity:.5}
.quarry-index__told{display:grid;gap:1.6rem}
.quarry-told{border-top:2px solid var(--qy-rule);padding-top:.9rem;max-width:40rem}
.quarry-told__name{display:flex;gap:.8rem;align-items:baseline;margin:0}
.quarry-told__tally{font-size:11.5px;font-weight:800;letter-spacing:.1em;
  color:var(--qy-accent)}
.quarry-told p{margin:.5rem 0 0;color:var(--qy-soft);font-size:15.5px;line-height:1.6}

/* the break — A RULE AND A HANGING LINE, with no band at all. Beacon's is a
   deep band on a near-white page, Anvil's a raised band on a dark one; this
   is the page's own grid doing the work. */
.quarry-break{padding:clamp(1.8rem,4vw,2.6rem) 0 0}
.quarry-break p{margin:0;padding-top:1.1rem;border-top:2px solid var(--qy-rule);
  font-weight:800;letter-spacing:-.02em;font-size:clamp(1.15rem,3vw,1.6rem);
  max-width:28ch;text-wrap:balance}
/* A BAND EITHER SIDE KEEPS ITS OWN PADDING. The +.quarry-band rule above
   strips the top padding of whatever follows a band, and a break between two
   of them is exactly where that strip must not apply. */
.quarry-break+.quarry-band{padding-top:var(--qy-stack)}

/* the hours — weekdays in one column, the weekend in the other.
   A CONTAINER QUERY, NOT A MEDIA QUERY, AND THE SCREENSHOT IS WHY. This box
   is full-shell-wide on the home page and sits in a ~22rem aside beside the
   prose on a service page. A viewport rule cannot tell those apart, so at
   1440px the service page split a 22rem box into two columns and every row
   read

       Wednesday            7:00 AM
                             – 6:00
                                 PM

   THE BOX IS NOT THE PAGE. The question the rule has to ask is how wide
   THIS box is, which is the one thing a media query cannot answer.
   Pre-container-query browsers fall back to the single column, which is the
   phone layout and is correct, just not split. */
.quarry-hours{margin:2.2rem 0 0;background:var(--qy-raise);
  border:2px solid var(--qy-rule);padding:1.2rem 1.3rem;container-type:inline-size}
.quarry-hours h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--qy-soft);margin-bottom:.9rem}
.quarry-hours__split{display:grid;gap:0}
.quarry-hours__col{margin:0}
.quarry-hours__day{display:flex;justify-content:space-between;gap:1rem;
  padding:.5rem 0;border-bottom:1px solid var(--qy-hair);font-size:15px}
.quarry-hours__day dt{font-weight:700}
.quarry-hours__day dd{margin:0;text-align:right}
.quarry-hours--shut dd{color:var(--qy-soft);font-weight:400}
.quarry-hours__note{margin:.9rem 0 0;font-size:13.5px;color:var(--qy-soft)}
/* 30rem IS MEASURED, NOT ROUND. The widest row is a long day name against a
   full range — Wednesday plus 7:00 AM – 6:00 PM — which wants about 15rem of
   column. Two of those plus the gap is 32rem of content, so the box needs
   roughly 30rem inside its padding before the split is an improvement
   rather than the wrapping above. */
@container (min-width:30rem){
  .quarry-hours__split{grid-template-columns:1fr 1fr;gap:0 2.2rem}
}

/* the map */
.quarry-map iframe{width:100%;height:clamp(16rem,50vw,24rem);border:2px solid var(--qy-rule);
  display:block;filter:grayscale(.35) contrast(1.04)}

/* the ring sentence */
.quarry-onward{margin:2.4rem 0 0;padding-top:1.2rem;border-top:2px solid var(--qy-rule);
  color:var(--qy-soft);font-size:15.5px}

/* the contact page — form first, facts after it, which on a phone is the
   only order that puts the thing they came to do above the fold */
.quarry-beside{display:grid;gap:var(--qy-stack)}
.quarry-aside{display:grid;gap:1.6rem;align-content:start}
.quarry-aside .quarry-prose h2{margin:0 0 .5rem;font-size:1.05rem}
.quarry-form{background:var(--qy-card);border:2px solid var(--qy-rule);padding:1.4rem}
.quarry-form__pair{display:grid;gap:0}
.quarry-form label{display:block;font-size:11px;font-weight:800;letter-spacing:.14em;
  text-transform:uppercase;color:var(--qy-soft);margin:1rem 0 .35rem}
.quarry-form__pair>div:first-child label{margin-top:0}
/* 16px OR THE PHONE ZOOMS. Safari on iOS scales the whole page up when a
   focused field's text is under 16px, and it does not scale back out. */
.quarry-form input,.quarry-form textarea{width:100%;font:inherit;font-size:16px;
  color:var(--qy-ink);background:var(--qy-raise);border:1px solid var(--qy-rule);
  padding:.65rem .8rem}
.quarry-form textarea{min-height:8rem;resize:vertical}
.quarry-form input:focus,.quarry-form textarea:focus{outline:2px solid var(--qy-accent);
  outline-offset:1px}
.quarry-form button{margin-top:1.3rem;font:inherit;font-weight:800;font-size:15.5px;
  cursor:pointer;background:var(--qy-accent);color:var(--qy-accent-ink);
  border:2px solid var(--qy-accent);padding:.78rem 1.5rem;width:100%}
.quarry-form button:hover{background:#344527;border-color:#344527}
.quarry-form__note{margin:1rem 0 0;font-size:14px;color:var(--qy-soft)}

/* the foot */
.quarry-foot{background:var(--qy-raise);border-top:2px solid var(--qy-rule);
  color:var(--qy-soft);padding:var(--qy-stack) 0 1.4rem;margin-top:var(--qy-stack)}
.quarry-foot a{color:var(--qy-ink);text-decoration:none}
.quarry-foot a:hover{color:var(--qy-accent)}
.quarry-foot__spread{display:grid;gap:1.8rem}
.quarry-foot__title{font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--qy-soft);font-weight:800}
.quarry-foot p{margin:.7rem 0 0;font-size:15px;line-height:1.6}
.quarry-foot ul{list-style:none;margin:.7rem 0 0;padding:0;font-size:15px}
.quarry-foot li{margin:0 0 .45rem}
.quarry-marks{display:flex;gap:.7rem}
.quarry-marks svg{width:19px;height:19px;fill:var(--qy-soft)}
.quarry-marks a:hover svg{fill:var(--qy-accent)}
.quarry-foot__base{display:flex;flex-wrap:wrap;gap:.4rem 1.3rem;margin-top:2rem;
  padding-top:1.2rem;border-top:1px solid var(--qy-hair);font-size:13.5px}

@media (min-width:640px){
  .quarry-brand__mark{height:70px;max-width:min(320px,42vw)}
  .quarry-kerb{grid-template-columns:repeat(3,1fr);gap:1.4rem}
  .quarry-form__pair{grid-template-columns:1fr 1fr;gap:1.1rem}
  .quarry-form__pair label{margin-top:0}
  .quarry-form button{width:auto}
  .quarry-foot__spread{grid-template-columns:1.4fr 1fr 1fr;gap:1.8rem}
  .quarry-index__told{gap:2rem}
}

@media (min-width:960px){
  /* THE DISCLOSURE BECOMES A DROPPED PANEL only once there is room beside
     it. Below this it stays in the flow — see the note on __list above. */
  .quarry-menu__list{position:absolute;top:calc(100% + .8rem);left:-.9rem;z-index:20;
    margin:0;padding:.4rem;min-width:250px;background:var(--qy-card);
    border:2px solid var(--qy-rule);box-shadow:8px 8px 0 rgba(28,30,26,.14)}
  .quarry-menu__list a{padding:.5rem .7rem}
  .quarry-menu__list a:hover{background:var(--qy-ground)}
  .quarry-menu__all{border-bottom:1px solid var(--qy-hair);
    margin-bottom:.3rem;padding-bottom:.3rem}
  /* THE INDEX, AT LAST IN TWO COLUMNS. The names stick while the blurbs run
     past. It needs no top offset, because the bar is not sticky. */
  .quarry-index{grid-template-columns:17rem minmax(0,1fr);gap:3rem}
  .quarry-index__col{display:block;position:sticky;top:2rem;align-self:start}
  /* AND THE BLURBS DROP THEIR OWN NUMBERS, because the column beside them is
     now carrying them. Two sets of 01..06 on one screen is a numbering the
     reader has to reconcile. */
  .quarry-told__tally{display:none}
  .quarry-beside{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);
    gap:clamp(2rem,4vw,3.4rem);align-items:start}
}
`,
};

/**
 * Harbor — the one with a rail.
 *
 * THE FIFTH, AND THE FIRST THAT IS NOT A STACK OF BANDS. Ledger, Beacon,
 * Anvil and Quarry are all one column: header, sections, footer. They differ
 * in what the sections look like. Harbor differs in where they are — a
 * narrow column down the left carrying the name, the phone, the hours, the
 * address and all six services, fixed while the content scrolls past it.
 *
 *     ON EVERY OTHER LAYOUT THE PHONE NUMBER IS AT THE TOP AND THEN GONE.
 *     A reader three screens into "what moves the price" has nothing to
 *     ring. That is the one measurable thing this layout is for.
 *
 * MOBILE FIRST, LIKE QUARRY AND UNLIKE THE FIRST THREE. The base rules are
 * the phone: the rail is an ordinary block at the top of the document, in
 * the flow, and becomes a rail at 960px. A 280px column beside a 360px
 * screen is not a column, and these sites ship no JavaScript to put it in a
 * drawer.
 *
 * THE PREFIX IS WHY FIVE CAN COEXIST. Every selector begins `.harbor-` and
 * every custom property `--hb-`. Ledger's `--lg-`, Beacon's `--bn-`,
 * Anvil's `--av-` and Quarry's `--qy-` appear nowhere.
 *
 * WHAT MAKES IT A FIFTH DESIGN RATHER THAN A RECOLOUR
 *
 *   the rail   nothing else has one, and it takes four things off the
 *              page: the facts block, the hours, the menu and most of the
 *              footer. Those absences are the design.
 *   colour     navy rail, oyster page, brass accent. Ledger is teal on
 *              warm paper, Beacon blue on near-white, Anvil amber on
 *              near-black, Quarry moss on stone.
 *   the photo  inset in the column like a figure in a book. Quarry's is
 *              full bleed, Anvil's is behind the headline, and a
 *              full-width band on a page with a rail down one side cannot
 *              be centred on anything.
 *   services   a definition list, name then line, reading down. Ledger
 *              numbers two columns, Beacon tiles three-up, Anvil stacks
 *              rungs, Quarry sticks an index beside the blurbs.
 *   the break  the sentence first and the rule under it, so it reads as
 *              the end of what came before rather than the start of what
 *              follows.
 *
 * NO DARK-MODE BLOCK, like the other four. A `prefers-color-scheme` section
 * would be a sixth palette maintained by nobody, and the page already
 * states its own ground on `body`.
 */
const HARBOR = {
  key: 'harbor',
  label: 'Harbor',
  prefix: 'harbor-',
  css: `:root{
  --hb-ink:#15202b; --hb-soft:#5a6675; --hb-line:#dcd8cf;
  --hb-page:#f4f1ea; --hb-card:#fff;
  --hb-rail:#15202b; --hb-rail-ink:#e8e4db; --hb-rail-soft:#9aa7b4;
  --hb-rail-line:rgba(255,255,255,.13);
  --hb-brass:#b07d2b; --hb-brass-ink:#fff;
  --hb-gutter:clamp(1.1rem,5vw,2.6rem);
  --hb-stack:clamp(2rem,5vw,3.2rem);
  --hb-rail-w:17rem;
  --hb-round:3px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--hb-page);color:var(--hb-ink);
  font:17px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
h1,h2,h3{font-weight:700;letter-spacing:-.02em;line-height:1.2;margin:0}
h1{font-size:clamp(1.9rem,5.5vw,2.9rem)}
h2{font-size:clamp(1.25rem,2.6vw,1.6rem)}
h3{font-size:1.05rem}
a{color:#8a5f18}
img{max-width:100%;display:block}
.harbor-skip{position:absolute;left:-9999px}
.harbor-skip:focus{left:1rem;top:1rem;background:var(--hb-brass);color:var(--hb-brass-ink);
  padding:.6rem 1rem;z-index:99;border-radius:var(--hb-round)}

/* THE RAIL — a block at the top on a phone, a fixed column at 960px.
   IN THE FLOW BY DEFAULT. position:fixed here would put a 17rem panel over
   a 360px screen with the page behind it, which is the failure a drawer
   exists to avoid and these sites have no JavaScript to build one. */
.harbor-rail{background:var(--hb-rail);color:var(--hb-rail-ink)}
.harbor-rail__inner{padding:1.4rem var(--hb-gutter) 1.6rem}
.harbor-rail a{color:var(--hb-rail-ink)}

.harbor-mark{display:flex;align-items:center;gap:.7rem;text-decoration:none;
  color:inherit;min-width:0}
/* NO PLATE BEHIND THE LOGO — the rail is dark, so this is Anvil's problem
   and Anvil's answer: a logo drawn in dark ink on transparency vanishes
   here. The plate is unconditional because nothing can see inside a PNG.
   The height matches the other four so one upload looks the same size
   whichever layout it lands in. */
.harbor-mark__img{background:#fff;border-radius:var(--hb-round);padding:.4rem .55rem;
  height:70px;width:auto;max-width:min(240px,60vw);object-fit:contain;object-position:left center}
.harbor-mark__glyph{width:42px;height:42px;border-radius:var(--hb-round);
  background:var(--hb-brass);color:var(--hb-brass-ink);display:grid;place-items:center;
  font-size:15px;font-weight:800;flex:0 0 auto}
.harbor-mark__name{font-size:17px;font-weight:700;letter-spacing:-.01em}

/* THE CALL BUTTON, FULL WIDTH AND NEVER OFF SCREEN. */
.harbor-call{display:flex;align-items:baseline;gap:.5rem;justify-content:center;
  margin:1.1rem 0 0;background:var(--hb-brass);color:var(--hb-brass-ink);
  font-weight:800;font-size:17px;text-decoration:none;padding:.8rem 1rem;
  border-radius:var(--hb-round)}
.harbor-call span{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;
  opacity:.85}
.harbor-call:hover{background:#96691f}

.harbor-menu{margin:1.6rem 0 0;font-size:15.5px}
.harbor-menu__title,.harbor-open__title{font-size:11px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--hb-rail-soft);font-weight:800;margin:0 0 .6rem}
.harbor-menu ul{list-style:none;margin:0;padding:0}
.harbor-menu li{border-top:1px solid var(--hb-rail-line)}
.harbor-menu li:last-child{border-bottom:1px solid var(--hb-rail-line)}
.harbor-menu a{display:block;padding:.5rem 0;text-decoration:none;color:var(--hb-rail-ink)}
.harbor-menu a:hover{color:var(--hb-brass)}
/* THE PAGE YOU ARE ON, MARKED. A rail that lists six services on all six
   service pages and never says which one you are reading is six identical
   menus. */
.harbor-menu a[aria-current]{color:var(--hb-brass);font-weight:700}
.harbor-menu__rest{margin-top:1.1rem}

.harbor-open{margin:1.6rem 0 0}
.harbor-open dl{margin:0;font-size:14px}
.harbor-open__row{display:flex;justify-content:space-between;gap:.8rem;
  padding:.32rem 0;border-bottom:1px solid var(--hb-rail-line)}
.harbor-open__row dt{color:var(--hb-rail-soft)}
/* THE TIMES DO NOT WRAP. The rail is 17rem and the row is a flex with the
   day at one end and the hours at the other; "7:00 AM - 6:00 PM" is just
   wide enough to break after the dash next to a long day name, which puts
   "PM" alone on a line against "Wednesday". The day shrinks instead. */
.harbor-open__row dd{margin:0;text-align:right;white-space:nowrap}
.harbor-open__row dt{min-width:0;overflow:hidden;text-overflow:ellipsis}
.harbor-open__row--shut dd{color:var(--hb-rail-soft)}
.harbor-rail__where{margin:1.5rem 0 0;font-size:14.5px;line-height:1.55;
  color:var(--hb-rail-soft)}

/* THE CONTENT COLUMN */
.harbor-main{padding:0 var(--hb-gutter)}
.harbor-column{max-width:46rem;margin:0 auto;padding:var(--hb-stack) 0 0}
.harbor-top h1{text-wrap:balance;max-width:20ch}
.harbor-top__said{color:var(--hb-soft);font-size:clamp(1.02rem,2.4vw,1.14rem);
  margin:.9rem 0 0;max-width:46ch}

/* THE PHOTOGRAPH, INSET. A full-bleed band on a page with a rail down one
   side starts in an odd place and is centred on nothing. */
.harbor-plate{margin:var(--hb-stack) 0 0}
.harbor-plate img{width:100%;height:clamp(11rem,38vw,17rem);object-fit:cover;
  object-position:50% 12%;border-radius:var(--hb-round)}

.harbor-block{padding:var(--hb-stack) 0 0}
.harbor-block>h2{margin:0 0 1rem}
.harbor-said{color:var(--hb-soft);margin:-.4rem 0 1.4rem;max-width:46ch}
.harbor-prose{max-width:42rem}
.harbor-prose h2{margin:2rem 0 .7rem}
.harbor-prose p{margin:0 0 1rem}
.harbor-prose ul{margin:0 0 1rem;padding-left:1.15rem}
.harbor-prose li{margin:0 0 .45rem}
.harbor-lede{font-size:1.1rem;color:#2b3845}

/* THE SERVICES — a definition list, name then line, reading down. */
.harbor-offer{margin:0}
.harbor-offer__row{padding:.95rem 0;border-top:1px solid var(--hb-line)}
.harbor-offer__row:last-child{border-bottom:1px solid var(--hb-line)}
.harbor-offer__row dt{font-weight:700;font-size:1.05rem}
.harbor-offer__row dt a{color:inherit;text-decoration:none}
.harbor-offer__row dt a:hover{color:#8a5f18}
.harbor-offer__row dd{margin:.3rem 0 0;color:var(--hb-soft);font-size:15.5px}
/* A ROW THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
   NOT. The services past the body cap are shown and unlinked, so they are
   visibly muted rather than quietly inert. */
.harbor-offer__row--flat{opacity:.55}

/* THE BREAK — the sentence, then the rule under it. */
.harbor-break{margin:var(--hb-stack) 0 0}
.harbor-break p{margin:0 0 1.1rem;font-weight:700;letter-spacing:-.015em;
  font-size:clamp(1.1rem,2.6vw,1.45rem);max-width:30ch;text-wrap:balance}
.harbor-break::after{content:"";display:block;border-top:2px solid var(--hb-ink)}

.harbor-map iframe{width:100%;height:clamp(15rem,46vw,22rem);border:1px solid var(--hb-line);
  border-radius:var(--hb-round);display:block;filter:grayscale(.25)}

.harbor-onward{margin:2.2rem 0 0;padding-top:1.1rem;border-top:1px solid var(--hb-line);
  color:var(--hb-soft);font-size:15.5px}

/* THE CONTACT FORM */
.harbor-form{background:var(--hb-card);border:1px solid var(--hb-line);
  border-radius:var(--hb-round);padding:1.4rem}
.harbor-form__pair{display:grid;gap:0}
.harbor-form label{display:block;font-size:11px;font-weight:800;letter-spacing:.14em;
  text-transform:uppercase;color:var(--hb-soft);margin:1rem 0 .35rem}
.harbor-form__pair>div:first-child label{margin-top:0}
/* 16px OR THE PHONE ZOOMS. Safari on iOS scales the whole page up when a
   focused field's text is under 16px, and it does not scale back out. */
.harbor-form input,.harbor-form textarea{width:100%;font:inherit;font-size:16px;
  color:var(--hb-ink);background:var(--hb-page);border:1px solid var(--hb-line);
  border-radius:var(--hb-round);padding:.65rem .8rem}
.harbor-form textarea{min-height:8rem;resize:vertical}
.harbor-form input:focus,.harbor-form textarea:focus{outline:2px solid var(--hb-brass);
  outline-offset:1px}
.harbor-form button{margin-top:1.3rem;font:inherit;font-weight:800;font-size:15.5px;
  cursor:pointer;background:var(--hb-brass);color:var(--hb-brass-ink);border:0;
  border-radius:var(--hb-round);padding:.78rem 1.5rem;width:100%}
.harbor-form button:hover{background:#96691f}
.harbor-form__note{margin:1rem 0 0;font-size:14px;color:var(--hb-soft)}

/* THE FOOT — short, because the rail carries what a footer usually repeats. */
.harbor-foot{margin:var(--hb-stack) 0 0;padding:1.3rem 0 2.2rem;
  border-top:1px solid var(--hb-line);color:var(--hb-soft);font-size:14px}
.harbor-foot__legal{display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;margin:0}
.harbor-foot a{color:var(--hb-ink);text-decoration:none}
.harbor-foot a:hover{color:#8a5f18}
.harbor-marks{display:flex;gap:.7rem;margin:1rem 0 0}
.harbor-marks svg{width:18px;height:18px;fill:var(--hb-soft)}
.harbor-marks a:hover svg{fill:#8a5f18}
.harbor-foot__base{margin:1rem 0 0}

@media (min-width:640px){
  .harbor-form__pair{grid-template-columns:1fr 1fr;gap:1.1rem}
  .harbor-form__pair label{margin-top:0}
  .harbor-form button{width:auto}
}

@media (min-width:960px){
  /* AND NOW IT IS A RAIL. Fixed rather than sticky: the whole column is
     one screen tall and scrolls inside itself if it has to, so a long list
     of services cannot push the address off the bottom of a short window. */
  .harbor-rail{position:fixed;top:0;left:0;bottom:0;width:var(--hb-rail-w);
    overflow-y:auto;border-right:1px solid var(--hb-rail-line)}
  .harbor-rail__inner{padding:1.8rem 1.5rem 2rem}
  .harbor-main{margin-left:var(--hb-rail-w);padding:0 clamp(2rem,4vw,4rem)}
  .harbor-column{padding-top:clamp(3rem,6vw,4.5rem)}
  .harbor-mark__img{max-width:100%}
}
`,
};

const ATLAS = {
  key: 'atlas',
  label: 'Atlas',
  prefix: 'atlas-',
  css: `:root{
  --at-ink:#23201c; --at-soft:#6f6859; --at-line:#ded8cb; --at-page:#faf8f3;
  --at-mark:#8a6a2f;
  --at-gutter:clamp(1.1rem,5vw,2.4rem);
  --at-stack:clamp(1.9rem,4.5vw,2.9rem);
  /* THE MARGIN. Wide enough for "What to have ready" on two lines and no
     wider: past about 13rem the text column starts drifting right of
     centre on a 1280px screen and the page reads lopsided rather than
     indexed. */
  --at-label:11.5rem;
  --at-gap:2.4rem;
  --at-wrap:64rem;
  --at-serif:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif;
  --at-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
/* THE TYPE IS INVERTED FROM LEDGER'S — body in the serif, labels in the
   sans. Ledger sets headings in Georgia over a sans body; doing that here
   would make this a third brochure with its headings moved sideways. */
body{margin:0;background:var(--at-page);color:var(--at-ink);
  font:17.5px/1.7 var(--at-serif);
  -webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;line-height:1.22}
h1{font-size:clamp(1.85rem,5.2vw,2.7rem);font-weight:400;letter-spacing:-.012em}
h3{font-size:1.02rem;font-weight:700}
a{color:var(--at-mark)}
img{max-width:100%;display:block}
.atlas-skip{position:absolute;left:-9999px}
.atlas-skip:focus{left:1rem;top:1rem;background:var(--at-ink);color:var(--at-page);
  padding:.6rem 1rem;z-index:99;font-family:var(--at-sans);font-size:14px}

/* ONE CONTAINER, USED BY THE BAR AND BY THE PAGE, so the name at the top
   and the first label below it sit on the same vertical. Two containers
   with the same numbers in them is the same rule written twice and wrong
   once. */
.atlas-wrap{max-width:var(--at-wrap);margin:0 auto;padding:0 var(--at-gutter)}

/* THE BAR, AND THE DOUBLE RULE UNDER IT. A thick line with a hairline
   below is what the top of a printed reference page looks like, and it is
   the whole of this structure's furniture. */
/* padding-top AND padding-bottom, NEVER THE padding SHORTHAND. This element
   carries .atlas-wrap as well, and the wrap is what gives the page its side
   gutter. A shorthand here sets all four sides, so "padding:1.05rem 0 .9rem"
   silently set left and right to zero — and this rule comes later in the
   file, so it won. The result was a bar with no gutter on any page: the logo
   flush against the left edge of a phone and the number flush against the
   right, while the menu one line below it was correctly indented.

       A SHORTHAND DOES NOT SET THE PROPERTIES YOU WROTE.
       IT SETS ALL OF THEM, AND THE ONES LEFT OUT GO BACK TO ZERO.

   Found by measuring the rendered bar, not by reading the rule. */
.atlas-head__top{display:flex;align-items:center;justify-content:space-between;
  gap:1rem;padding-top:1.05rem;padding-bottom:.9rem}
.atlas-mark{text-decoration:none;color:inherit;min-width:0}
.atlas-mark__img{height:70px;width:auto;max-width:min(240px,55vw);
  object-fit:contain;object-position:left center}
.atlas-mark__name{font-size:1.18rem;letter-spacing:-.01em}
.atlas-dial{font-family:var(--at-sans);font-size:15px;font-weight:700;
  white-space:nowrap;text-decoration:none;color:var(--at-ink);
  border-bottom:2px solid var(--at-mark);padding-bottom:1px}
.atlas-dial:hover{color:var(--at-mark)}
.atlas-nav{border-top:1px solid var(--at-line);border-bottom:3px solid var(--at-ink)}
.atlas-nav ul{list-style:none;margin:0;padding:.55rem 0;display:flex;
  flex-wrap:wrap;gap:.35rem 1.1rem;font-family:var(--at-sans);font-size:13.5px}
.atlas-nav a{color:var(--at-soft);text-decoration:none}
.atlas-nav a:hover{color:var(--at-ink)}
/* THE PAGE YOU ARE ON, MARKED. Six services listed on all six service
   pages with nothing saying which one you are reading is six identical
   menus. */
.atlas-nav a[aria-current]{color:var(--at-ink);font-weight:700}
.atlas-head::after{content:"";display:block;height:1px;margin-top:2px;
  background:var(--at-ink)}

/* THE TITLE BLOCK — the first thing that uses the margin, so the reader
   learns the page's shape before any section needs it. */
.atlas-top{padding:var(--at-stack) 0 0}
.atlas-top__mark{font-family:var(--at-sans);font-size:12px;font-weight:700;
  letter-spacing:.2em;color:var(--at-mark);margin:0 0 .5rem}
.atlas-top h1{text-wrap:balance;max-width:22ch}
.atlas-top__said{color:var(--at-soft);font-size:1.1rem;margin:.85rem 0 0;max-width:48ch}

/* THE PHOTOGRAPH CROSSES THE MARGIN. It is the one element that does, and
   that is why it reads as the page drawing breath rather than as a block
   that forgot the grid. */
.atlas-plate{margin:var(--at-stack) 0 0}
.atlas-plate img{width:100%;height:clamp(11rem,40vw,19rem);object-fit:cover;
  object-position:50% 12%}

/* A LEAF. On a phone the label is simply above its block, like every other
   structure; the margin arrives at the width that can hold one. */
.atlas-leaf{padding:var(--at-stack) 0 0}
.atlas-leaf__label h2{font-family:var(--at-sans);font-size:11.5px;font-weight:700;
  letter-spacing:.17em;text-transform:uppercase;color:var(--at-soft);
  margin:0 0 .75rem}

/* THE BODY OF A LEAF OWNS THE PROSE SPACING, AND IT IS THE ONLY THING THAT
   DOES. The first version had a separate prose wrapper with the same four
   rules on it, which meant a paragraph's margins depended on whether
   whoever built that block had remembered the wrapper — and the service
   page, whose sections ARE leaves, wrapped the leaves in it. Every block on
   this structure is a leaf, so the leaf is where the rules belong. */
.atlas-leaf__body{max-width:41rem}
.atlas-leaf__body p{margin:0 0 1.1rem}
.atlas-leaf__body>:last-child,.atlas-leaf__body p:last-child{margin-bottom:0}
.atlas-leaf__body ul{margin:0 0 1.1rem;padding-left:1.15rem}
.atlas-leaf__body li{margin:0 0 .5rem}
.atlas-lede{font-size:1.16rem;line-height:1.6}
/* NO MEASURE OF ITS OWN. It had 48ch, which on a 41rem text column is
   about two thirds of the width — so the one paragraph introducing the
   services wrapped visibly shorter than the three above it and the table
   below it, and read as a mistake rather than as an intro. The leaf body
   already caps the measure; a second, tighter cap on one block inside it is
   a block that does not line up with its own page. */
.atlas-said{color:var(--at-soft);margin:0 0 1.3rem}

/* THE SERVICES, AS A TABLE. On a phone the three cells stack, because a
   number, a name and a sentence across a 360px screen gives the sentence
   about nine characters a line. */
.atlas-index{width:100%;border-collapse:collapse;font-size:16.5px}
.atlas-index tr{border-top:1px solid var(--at-line)}
.atlas-index tr:last-child{border-bottom:1px solid var(--at-line)}
.atlas-index td{display:block;padding:0}
.atlas-index tr td:first-child{padding-top:.85rem}
.atlas-index tr td:last-child{padding-bottom:.95rem}
.atlas-index__num{font-family:var(--at-sans);font-size:11.5px;font-weight:700;
  letter-spacing:.14em;color:var(--at-mark)}
.atlas-index__name{font-size:1.1rem;margin:.1rem 0 .15rem}
.atlas-index__name a{color:inherit;text-decoration:none;
  border-bottom:1px solid var(--at-line)}
.atlas-index__name a:hover{color:var(--at-mark);border-bottom-color:var(--at-mark)}
.atlas-index__said{color:var(--at-soft);font-size:15.5px;line-height:1.55}
/* A ROW THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
   NOT. The services past the body-link cap are shown and unlinked, so they
   are visibly quieter rather than quietly inert. */
.atlas-index__row--flat .atlas-index__name{color:var(--at-soft)}

/* THE HOURS, AS A LINE OF TYPE. A run never breaks across lines: "Mon-Thu
   7:00 AM - 6:00" with "PM" alone underneath is the failure this shape
   exists to avoid. */
.atlas-hours{margin:0;font-size:16.5px}
.atlas-hours__run{white-space:nowrap}
/* THE SEPARATOR HANGS OFF THE END OF THE RUN BEFORE IT, NOT OFF THE FRONT
   OF THE RUN AFTER IT. As a ::before it is inside the following span, so
   when that span starts a new line the dot and its left margin go with it
   and the line begins indented — which stacked up into a staircase of four
   lines on a phone, each one further in than the last.

       A LEADING SEPARATOR IS PART OF WHAT FOLLOWS IT.
       IT WRAPS WITH IT.

   As an ::after on every run but the last, the dot sits inside the nowrap
   span it belongs to, the line break happens at the space after it, and a
   wrapped line starts flush. */
/* --at-soft, NOT --at-line. The hairline colour on the page colour is
   #ded8cb on #faf8f3, which is right for a rule a reader is not meant to
   look at and wrong for the only thing separating four times of day: on
   the contact page the dots simply were not there. A separator nobody can
   see is a line of hours run together. */
.atlas-hours__run:not(:last-child)::after{content:"\\00b7";color:var(--at-soft);
  margin-left:.5rem}

/* THE BREAK — the sentence sits where the labels go and the text column is
   left empty, so the break is a gap in the page's own grid. No rule at
   all, which is the one thing none of the other five does. */
.atlas-break{padding:var(--at-stack) 0 0}
.atlas-break p{margin:0;font-family:var(--at-sans);font-size:14.5px;
  font-weight:700;line-height:1.45;letter-spacing:-.005em;
  color:var(--at-ink);max-width:26ch;text-wrap:balance}

.atlas-map iframe{width:100%;height:clamp(15rem,46vw,21rem);border:1px solid var(--at-line);
  display:block;filter:grayscale(.3)}

.atlas-onward{margin:0;color:var(--at-soft);font-size:16px}

/* THE FORM, WITH NO BOX AROUND IT. Ledger and Harbor put theirs on a card;
   a card is a thing lifted off the page, and nothing on a reference page is
   lifted off the page. */
.atlas-form__pair{display:grid;gap:0}
.atlas-form label{display:block;font-family:var(--at-sans);font-size:11px;
  font-weight:700;letter-spacing:.15em;text-transform:uppercase;
  color:var(--at-soft);margin:1.1rem 0 .35rem}
.atlas-form__pair>div:first-child label{margin-top:0}
/* 16px OR THE PHONE ZOOMS. Safari on iOS scales the whole page up when a
   focused field's text is under 16px, and it does not scale back out. */
.atlas-form input,.atlas-form textarea{width:100%;font:inherit;font-size:16px;
  color:var(--at-ink);background:#fff;border:1px solid var(--at-line);
  border-radius:0;padding:.62rem .75rem}
.atlas-form textarea{min-height:8rem;resize:vertical}
.atlas-form input:focus,.atlas-form textarea:focus{outline:2px solid var(--at-mark);
  outline-offset:1px}
.atlas-form button{margin-top:1.3rem;font-family:var(--at-sans);font-size:14px;
  font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  background:var(--at-ink);color:var(--at-page);border:0;padding:.85rem 1.6rem;
  width:100%}
.atlas-form button:hover{background:var(--at-mark)}
.atlas-form__note{margin:1.1rem 0 0;font-size:15px;color:var(--at-soft)}

/* THE FOOT KEEPS THE GRID. A footer breaking into three equal columns —
   which is what the other five do — would be the one block on the page
   that abandoned the margin, directly under the block that proves it. */
.atlas-foot{margin:var(--at-stack) 0 0;padding-top:.5rem;
  border-top:3px solid var(--at-ink);font-size:15.5px;color:var(--at-soft)}
.atlas-foot p{margin:0 0 .6rem}
.atlas-foot a{color:var(--at-ink);text-decoration:none}
.atlas-foot a:hover{color:var(--at-mark)}
.atlas-foot__links{display:flex;flex-wrap:wrap;gap:.3rem 1.1rem;
  font-family:var(--at-sans);font-size:13.5px}
.atlas-marks{display:flex;gap:.7rem;margin:.9rem 0 0}
.atlas-marks svg{width:18px;height:18px;fill:var(--at-soft)}
.atlas-marks a:hover svg{fill:var(--at-mark)}
.atlas-foot__base{font-family:var(--at-sans);font-size:13px;
  padding:1.4rem 0 2.2rem;margin:var(--at-stack) 0 0;
  border-top:1px solid var(--at-line)}

@media (min-width:620px){
  .atlas-form__pair{grid-template-columns:1fr 1fr;gap:1.1rem}
  .atlas-form__pair label{margin-top:0}
  .atlas-form button{width:auto}
  /* AND NOW IT IS A TABLE AGAIN. */
  /* THE CELL SELECTORS CARRY tr td SO THEY CAN WIN. The phone rules above
     reach a cell through the table class, a row and a first-child
     pseudo-class; the column name on its own is one class and loses to
     that, so the widths here would have been set and then thrown away by a
     rule written for a 360px screen.
     AND NO BACKTICKS IN HERE. One ends this template literal early, which
     is the fourth time that has cost a syntax error in this project. */
  .atlas-index td,
  .atlas-index tr td:first-child,
  .atlas-index tr td:last-child{display:table-cell;padding:.9rem 0;
    vertical-align:baseline}
  .atlas-index tr td.atlas-index__num{width:3.2rem;padding-right:.8rem}
  .atlas-index tr td.atlas-index__name{width:13rem;padding-right:1.4rem;margin:0}
}

/* THE MARGIN ARRIVES. Everything above this line is the phone, which is
   the order Quarry set and Harbor followed: the structure is built for the
   small screen and the layout that names it is the enhancement. */
@media (min-width:900px){
  /* THE FOOTER'S LEAVES ARE NOT LISTED SEPARATELY, because they are
     leaves. A child selector naming the foot and the leaf together would
     be the same rule twice and wrong once. */
  .atlas-leaf,.atlas-top,.atlas-break{
    display:grid;grid-template-columns:var(--at-label) 1fr;gap:0 var(--at-gap);
    align-items:start}
  /* FLUSH RIGHT AGAINST THE TEXT. Left-aligned labels in a wide margin
     leave a ragged channel between the two columns; ranged right, the
     labels and the prose share one hard vertical, which is the edge the
     page is meant to be skimmed down. */
  .atlas-leaf__label,.atlas-top__mark{text-align:right}
  .atlas-top__mark{margin:.55rem 0 0;grid-column:1}
  .atlas-top__words{grid-column:2}
  .atlas-leaf__label h2{margin:.42rem 0 0}
  /* THE BREAK'S SENTENCE GOES IN THE MARGIN and the text column stays
     empty. It is ranged right with the labels because it is standing in
     the labels' column, not in the prose. */
  .atlas-break p{grid-column:1;text-align:right;justify-self:end}
  .atlas-foot__base{padding-left:calc(var(--at-label) + var(--at-gap))}
}
`,
};

const ORCHARD = {
  key: 'orchard',
  label: 'Orchard',
  prefix: 'orchard-',
  css: `:root{
  --oc-ink:#20291f; --oc-soft:#5d6b58; --oc-line:#dfe4d8; --oc-page:#fbfaf6;
  --oc-card:#fff; --oc-tint:#eef3e8;
  --oc-leaf:#3d6b3a; --oc-leaf-ink:#fff; --oc-sun:#c2703a;
  --oc-gutter:clamp(1.1rem,5vw,2.4rem);
  --oc-stack:clamp(1.6rem,4vw,2.4rem);
  --oc-hold:66rem;
  /* HOW FAR A CARD LEANS. The whole structure is this number: at 0 the page
     is a stack like four of the other six, and past about 18% the narrow
     side is too narrow to read. */
  --oc-lean:14%;
  --oc-round:14px;
  --oc-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--oc-page);color:var(--oc-ink);
  font:17px/1.65 var(--oc-sans);-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;line-height:1.22;letter-spacing:-.02em}
h1{font-size:clamp(1.9rem,5.4vw,2.8rem);font-weight:800}
h2{font-size:clamp(1.2rem,2.6vw,1.55rem);font-weight:800}
h3{font-size:1.08rem;font-weight:700}
a{color:#2f6b2c}
img{max-width:100%;display:block}
.orchard-skip{position:absolute;left:-9999px}
.orchard-skip:focus{left:1rem;top:1rem;background:var(--oc-leaf);color:var(--oc-leaf-ink);
  padding:.6rem 1rem;z-index:99;border-radius:var(--oc-round)}

.orchard-hold{max-width:var(--oc-hold);margin:0 auto;padding:0 var(--oc-gutter)}

/* THE BAR. Rounded everywhere it can be — Quarry is square on purpose and
   Atlas draws hard rules, so the corner radius is this structure's cheapest
   honest difference from both. */
.orchard-bar{background:var(--oc-card);border-bottom:1px solid var(--oc-line)}
/* padding-top AND padding-bottom, NEVER THE padding SHORTHAND: this element
   carries .orchard-hold as well, and a shorthand would set all four sides
   and wipe the side gutter the hold supplies. That shipped on Atlas and
   left the logo flush against the edge of a phone. */
.orchard-bar__top{display:flex;align-items:center;justify-content:space-between;
  gap:1rem;padding-top:1rem;padding-bottom:.85rem}
.orchard-mark{text-decoration:none;color:inherit;min-width:0}
.orchard-mark__img{height:70px;width:auto;max-width:min(240px,55vw);
  object-fit:contain;object-position:left center}
.orchard-mark__name{font-size:1.14rem;font-weight:800;letter-spacing:-.015em}
.orchard-dial{display:inline-flex;align-items:baseline;gap:.45rem;
  background:var(--oc-leaf);color:var(--oc-leaf-ink);text-decoration:none;
  font-weight:800;font-size:16.5px;white-space:nowrap;
  padding:.6rem 1rem;border-radius:999px}
.orchard-dial span{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;
  opacity:.85}
.orchard-dial:hover{background:#345c31}
.orchard-nav{border-top:1px solid var(--oc-line);background:var(--oc-page)}
.orchard-nav ul{list-style:none;margin:0;padding:.5rem 0;display:flex;
  flex-wrap:wrap;gap:.3rem 1rem;font-size:14px}
.orchard-nav a{color:var(--oc-soft);text-decoration:none}
.orchard-nav a:hover{color:var(--oc-ink)}
/* THE PAGE YOU ARE ON, MARKED. Six services listed on all six service pages
   with nothing saying which one you are reading is six identical menus. */
.orchard-nav a[aria-current]{color:var(--oc-leaf);font-weight:800}

/* THE TITLE, CENTRED — the only one of the seven that is. The sections lean
   left and right by turns, so there is no single edge for a title to hang
   from, and ranging it left would pick a side before the zigzag starts. */
.orchard-top{max-width:var(--oc-hold);margin:0 auto;
  padding:var(--oc-stack) var(--oc-gutter) 0;text-align:center}
.orchard-top h1{text-wrap:balance;max-width:22ch;margin:0 auto}
.orchard-top__said{color:var(--oc-soft);font-size:clamp(1.02rem,2.3vw,1.14rem);
  margin:.85rem auto 0;max-width:52ch}

/* THE PHOTOGRAPH, FULL WIDTH AND NOT LEANING. A picture that also leaned
   would make the page look like it was falling over rather than
   alternating. */
.orchard-plate{margin:var(--oc-stack) 0 0}
.orchard-plate img{width:100%;height:clamp(11rem,40vw,20rem);object-fit:cover;
  object-position:50% 12%}

.orchard-main{padding-bottom:var(--oc-stack)}

/* A ROW. On a phone it is simply a full-width card — an offset needs
   somewhere to offset INTO, and a 360px screen has none. The lean arrives
   at the width that can hold it. */
.orchard-row{max-width:var(--oc-hold);margin:0 auto;
  padding:var(--oc-stack) var(--oc-gutter) 0}
.orchard-card{background:var(--oc-card);border:1px solid var(--oc-line);
  border-radius:var(--oc-round);padding:clamp(1.1rem,3vw,1.8rem)}
.orchard-card--tint{background:var(--oc-tint);border-color:#d3dfc9}
.orchard-card>h2{margin:0 0 .9rem}
.orchard-card p{margin:0 0 1rem}
.orchard-card>:last-child,.orchard-card p:last-child{margin-bottom:0}
.orchard-card ul{margin:0 0 1rem;padding-left:1.15rem}
.orchard-card li{margin:0 0 .45rem}
.orchard-lede{font-size:1.1rem;color:#2c3a2a}
.orchard-said{color:var(--oc-soft);margin:0 0 1.2rem}

/* THE SERVICES — two up, with the number drawn large and hollow. Beacon is
   three-up tiles; the count and the numeral are what make this a different
   answer rather than Beacon with one removed. */
.orchard-grove{list-style:none;margin:0;padding:0;display:grid;gap:.9rem}
.orchard-fruit{position:relative;background:var(--oc-page);
  border:1px solid var(--oc-line);border-radius:var(--oc-round);
  padding:1rem 1.1rem;overflow:hidden}
.orchard-fruit__num{position:absolute;top:-.15rem;right:.5rem;font-size:3.2rem;
  font-weight:800;line-height:1;color:transparent;
  -webkit-text-stroke:1px var(--oc-line);pointer-events:none}
.orchard-fruit h3{margin:0 0 .3rem;position:relative}
.orchard-fruit h3 a{color:inherit;text-decoration:none}
.orchard-fruit h3 a:hover{color:var(--oc-leaf)}
.orchard-fruit p{margin:0;color:var(--oc-soft);font-size:15.5px;position:relative}
/* A ROW THAT LOOKS CLICKABLE AND IS NOT IS WORSE THAN ONE THAT PLAINLY IS
   NOT. The services past the body-link cap are shown and unlinked, so they
   are visibly quieter rather than quietly inert. */
.orchard-fruit--flat h3{color:var(--oc-soft)}

/* THE HOURS — a chip a day. The only one of the seven that reflows: seven
   chips wrap like words at any width, where a band or a table has to be
   told what to do at every breakpoint. */
.orchard-week{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.5rem}
/* ONE A ROW ON THE PHONE, AND THE SAME ONE A ROW SEVEN TIMES OVER.
   MEASURED, NOT GUESSED: two chips holding "7:00 AM - 6:00 PM" need about
   340px of track, and a 360px phone leaves the list 287. They only pair if
   the time drops to 12px, and the time is the thing somebody opened the
   page to read. Left to wrap on its own the list came out ragged — five
   days alone, then Saturday and Sunday paired because "Closed" is short —
   which looks like an accident, because it is one. Full width below 620
   makes the column a decision. */
.orchard-chip{display:flex;flex-direction:column;gap:.1rem;flex:1 1 100%;
  background:var(--oc-page);border:1px solid var(--oc-line);
  border-radius:999px;padding:.45rem .9rem;min-width:6.4rem}
.orchard-chip__day{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--oc-soft);font-weight:700}
.orchard-chip__when{font-size:14.5px;font-weight:700;white-space:nowrap}
.orchard-chip--shut{opacity:.6}
.orchard-chip--shut .orchard-chip__when{font-weight:600;color:var(--oc-soft)}

/* THE BREAK — centred between two short rules, which is the shape left and
   the only one that sits in the middle. Between two cards leaning opposite
   ways, anything ranged to a side would pick one of them. */
.orchard-break{max-width:var(--oc-hold);margin:0 auto;
  padding:var(--oc-stack) var(--oc-gutter) 0;
  display:flex;align-items:center;gap:1rem;justify-content:center}
.orchard-break p{margin:0;font-weight:800;letter-spacing:-.015em;
  font-size:clamp(1.05rem,2.5vw,1.35rem);text-align:center;max-width:32ch;
  text-wrap:balance}
.orchard-break__rule{flex:0 1 4rem;height:2px;background:var(--oc-line)}

.orchard-map iframe{width:100%;height:clamp(15rem,46vw,21rem);border:0;
  border-radius:var(--oc-round);display:block}

.orchard-onward{margin:0;color:var(--oc-soft);font-size:16px}

/* THE CONTACT FORM */
.orchard-form__pair{display:grid;gap:0}
.orchard-form label{display:block;font-size:11.5px;font-weight:800;
  letter-spacing:.1em;text-transform:uppercase;color:var(--oc-soft);
  margin:1rem 0 .35rem}
.orchard-form__pair>div:first-child label{margin-top:0}
/* 16px OR THE PHONE ZOOMS. Safari on iOS scales the whole page up when a
   focused field's text is under 16px, and it does not scale back out. */
.orchard-form input,.orchard-form textarea{width:100%;font:inherit;font-size:16px;
  color:var(--oc-ink);background:var(--oc-page);border:1px solid var(--oc-line);
  border-radius:10px;padding:.65rem .8rem}
.orchard-form textarea{min-height:8rem;resize:vertical}
.orchard-form input:focus,.orchard-form textarea:focus{outline:2px solid var(--oc-leaf);
  outline-offset:1px}
.orchard-form button{margin-top:1.3rem;font:inherit;font-weight:800;font-size:16px;
  cursor:pointer;background:var(--oc-leaf);color:var(--oc-leaf-ink);border:0;
  border-radius:999px;padding:.8rem 1.8rem;width:100%}
.orchard-form button:hover{background:#345c31}
.orchard-form__note{margin:1rem 0 0;font-size:14.5px;color:var(--oc-soft)}

/* THE FOOT — centred, like the masthead and for the same reason. */
.orchard-foot{margin:var(--oc-stack) 0 0;padding:1.8rem 0 2.4rem;
  background:var(--oc-card);border-top:1px solid var(--oc-line);
  text-align:center;color:var(--oc-soft);font-size:15px}
/* ⚠ EVERY ONE OF THESE CARRIES .orchard-foot, AND THE FIRST VERSION DID
   NOT. The rule above is a class and a type together — specificity
   (0,1,1) — and each of these alone is one class, (0,1,0). So it WON, and
   it set all four sides: the address lost its auto margins and sat left of
   centre in a centred footer, and the icons, the links and the copyright
   all lost their margin-top.

       ONE SHORTHAND ON A MORE SPECIFIC SELECTOR SILENTLY UNDID
       FOUR RULES WRITTEN UNDERNEATH IT.

   This is the same trap as the bar at the top of this block, wearing a
   different coat: there it was source order, here it is specificity, and
   both times the property nobody mentioned is the one that moved. Found by
   measuring the rendered footer, not by reading the rules. */
.orchard-foot p{margin:0 0 .5rem}
.orchard-foot .orchard-foot__name{font-weight:800;color:var(--oc-ink);font-size:17px}
.orchard-foot .orchard-foot__where{max-width:40ch;margin-left:auto;margin-right:auto}
.orchard-foot__tel{color:var(--oc-ink);font-weight:700;text-decoration:none}
.orchard-foot .orchard-foot__links{display:flex;flex-wrap:wrap;gap:.3rem 1rem;
  justify-content:center;font-size:14px;margin:1rem 0 .5rem}
.orchard-foot__links a{color:var(--oc-soft);text-decoration:none}
.orchard-foot__links a:hover{color:var(--oc-ink)}
.orchard-foot .orchard-marks{display:flex;gap:.7rem;justify-content:center;
  margin:.9rem 0 .5rem}
.orchard-marks svg{width:18px;height:18px;fill:var(--oc-soft)}
.orchard-marks a:hover svg{fill:var(--oc-leaf)}
.orchard-foot .orchard-foot__base{margin:1rem 0 0;font-size:13px}

@media (min-width:620px){
  .orchard-form__pair{grid-template-columns:1fr 1fr;gap:1.1rem}
  .orchard-form__pair label{margin-top:0}
  .orchard-form button{width:auto}
  .orchard-grove{grid-template-columns:1fr 1fr;gap:1rem}
  /* AND HERE THE CHIPS ARE LET GO. Above this width there is room for two
     without shrinking the time, so they take their own width again and
     wrap like words — which is what the shape was for. */
  .orchard-chip{flex:0 1 auto}
}

/* AND NOW THE PAGE LEANS. Everything above this line is the phone, which is
   the order Quarry set, Harbor followed and Atlas followed: the structure is
   built for the small screen and the layout that names it is the
   enhancement.
   AN OFFSET NEEDS SOMEWHERE TO OFFSET INTO. Below this width there is none,
   and a card squeezed to 86% of a 360px screen is not a design, it is a
   margin somebody forgot to remove. */
@media (min-width:900px){
  .orchard-row--left .orchard-card{margin-right:var(--oc-lean)}
  .orchard-row--right .orchard-card{margin-left:var(--oc-lean)}
}
`,
};

/**
 * The structures, by key.
 *
 * SEVEN, AND ALL SEVEN ARE REAL. Ledger, Beacon, Anvil, Quarry, Harbor,
 * Atlas and Orchard each have markup, a stylesheet and prompts of their own.
 *
 * BEING IN HERE IS NOT BEING OFFERED. structureKeys() lists what a wizard
 * MAY offer; designs.js decides what one DOES, and Quarry's row there is
 * tagged to a mode that has no wizard yet. A structure is registered first
 * and offered later, on purpose: the alternative is five layouts landing in
 * the dropdown the moment the first of them compiles.
 *
 * THE STYLESHEETS ARE HERE AND THE PAGE BUILDERS ARE NOT, deliberately.
 * chrome.js imports CSS_PATH from this file, so a structure object carrying
 * its own pages module would make theme -> pages -> chrome -> theme a
 * require cycle. structures.js joins the two halves and is the only file
 * that knows about both.
 */
const STRUCTURES = {
  [LEDGER.key]: LEDGER, [BEACON.key]: BEACON,
  [ANVIL.key]: ANVIL, [QUARRY.key]: QUARRY,
  [HARBOR.key]: HARBOR, [ATLAS.key]: ATLAS,
  [ORCHARD.key]: ORCHARD,
};

const DEFAULT_STRUCTURE = LEDGER.key;

/**
 * The structure for a site, never undefined.
 *
 * FALLS BACK RATHER THAN THROWS, and that is the opposite of what
 * normalizeSiteMode() does with a bad mode — on purpose. An unknown MODE
 * must not quietly build a different product; an unknown STRUCTURE is a
 * cosmetic choice, and refusing to build a paid-for site over a typo in a
 * layout name would be the worse failure.
 */
function structureFor(key) {
  return STRUCTURES[String(key || '').trim().toLowerCase()] || STRUCTURES[DEFAULT_STRUCTURE];
}

/**
 * Where the stylesheet is written.
 *
 * ONE CONSTANT NOW, AND IT USED TO BE TWO. CSS_HREF held '/assets/site.css'
 * — the same file with a leading slash — and chrome.js linked to that, which
 * is how every page in the site came to carry an absolute stylesheet href
 * that only resolves at a domain root.
 *
 * The href is no longer a constant at all, because it is not one: it depends
 * on how deep the page doing the linking sits. assetTo(CSS_PATH, depth) in
 * shape.js builds it, and the comment on linkTo() there records what the
 * absolute version cost.
 */
const CSS_PATH = 'assets/site.css';

/**
 * The 42x42 icon in the browser tab.
 *
 * THIS MODE HAD NONE AT ALL UNTIL 19 NOVEMBER, and the omission was
 * deliberate at both ends: document() emitted no <link rel="icon">, so
 * placeLogo() did not write the file, "because a favicon would be a file
 * nothing references". Each half was correct given the other, and together
 * they were a tab with a blank page icon on every site this mode built.
 *
 *     TWO HALVES THAT EACH CITE THE OTHER AS THE REASON ARE NOT
 *     A DECISION. THEY ARE A DECISION NOBODY EVER MADE.
 *
 * Edwin, 19 November, looking at a live site: *"I dont see any favicon"*.
 *
 * A CONSTANT RATHER THAN A FIELD ON THE SOURCE, which is what the logo is.
 * The logo can be an upload, so its filename varies and the source has to
 * carry it. This one is always drawn by faviconSvg() — the trade mark where
 * there is one, the business's initials where there is not — so the name
 * never varies and seven chrome.js files can name it without being told.
 */
const FAVICON_PATH = 'assets/favicon.png';

module.exports = {
  LEDGER,
  BEACON,
  /* ANVIL AND QUARRY ARE NOT EXPORTED BY NAME and neither was ANVIL before
   * them. Nothing outside this file wants one structure object; the suites
   * reach them through STRUCTURES, which is the list that cannot go stale. */
  STRUCTURES,
  DEFAULT_STRUCTURE,
  structureFor,
  CSS_PATH,
  FAVICON_PATH,
};
