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
 * The structures, by key.
 *
 * THREE OF THE FOUR ARE REAL. Ledger, Beacon and Anvil each have markup, a
 * stylesheet and prompts of their own. The fourth exists in no form at all.
 *
 * THE STYLESHEETS ARE HERE AND THE PAGE BUILDERS ARE NOT, deliberately.
 * chrome.js imports CSS_PATH from this file, so a structure object carrying
 * its own pages module would make theme -> pages -> chrome -> theme a
 * require cycle. structures.js joins the two halves and is the only file
 * that knows about both.
 */
const STRUCTURES = { [LEDGER.key]: LEDGER, [BEACON.key]: BEACON, [ANVIL.key]: ANVIL };

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

module.exports = {
  LEDGER,
  BEACON,
  STRUCTURES,
  DEFAULT_STRUCTURE,
  structureFor,
  CSS_PATH,
};
