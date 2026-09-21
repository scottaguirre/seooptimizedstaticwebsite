// /public/js/generateDinamycForm.js
(function () {

  // CSS Design options
  const THEMES = [
    { key: 'style',  label: 'Design 1', preview: '/previews/style.png'  },
    { key: 'style2', label: 'Design 2', preview: '/previews/style2.png' },
    { key: 'style3', label: 'Design 3', preview: '/previews/style3.png' },
    { key: 'style4', label: 'Design 4', preview: '/previews/style4.png' },
    { key: 'style5', label: 'Design 5', preview: '/previews/style5.png' },
    { key: 'style6', label: 'Design 6', preview: '/previews/style6.png' }
    // add more later: { key: 'style3', label: 'Style 3', preview: '/previews/style3.jpg' }, ...
  ];

  
  // -----------------------------
  // Small helpers
  // -----------------------------
  const el = (tag, attrs = {}, html = '') => {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('data-')) node.setAttribute(k, v);
      else node[k] = v;
    });
    if (html) node.innerHTML = html;
    return node;
  };

  // Dismissible alert (no auto-dismiss)
  function showAlert(container, msg) {
    container.querySelectorAll('.js-inline-alert').forEach(n => n.remove());
    const box = document.createElement('div');
    box.className = 'alert alert-danger js-inline-alert';
    box.setAttribute('role', 'alert');
    box.style.marginBottom = '1rem';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'space-between';

    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => box.remove());

    box.append(msgSpan, closeBtn);
    container.prepend(box);
  }


  
  // Create hidden inputs for each entry in a { name: value } map
  // Fields owned by wizard state rather than by the main form.
  //
  // snapshotFormValues() captures every input in the form, including hidden
  // mirrors injected on a previous pass. Re-injecting those alongside the
  // authoritative value produced two inputs with the same name — and the
  // stale one could win, which is how picking style5 generated style.css.
  const STATE_OWNED_FIELDS = [
    'global[styleKey]',
    'global[logoType]',
    'global[businessType]',
    'global[siteMode]',
  ];

  function injectHiddenSnapshot(form, snapshot, cssClass = 'js-hidden-mainform', filterFn) {
    // wipe any previous mirrors
    form.querySelectorAll('.' + cssClass).forEach(n => n.remove());

    const wrap = document.createElement('div');
    wrap.className = cssClass;
    wrap.style.display = 'none';

    Object.entries(snapshot || {}).forEach(([name, val]) => {
      if (filterFn && !filterFn(name, val)) return;

      // For checkboxes we stored true/false. Send "true" when checked, "" when not.
      const v = typeof val === 'boolean' ? (val ? 'true' : '') : (val ?? '');
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = v;
      wrap.appendChild(input);
    });

    form.appendChild(wrap);
  }



  // Snapshot / restore non-file inputs in the main form
  // Hidden mirrors are copies of the main form injected before submit. They
  // stay in the DOM, and because they are appended AFTER the visible fields,
  // walking every input let a stale mirror overwrite a value the user had
  // just changed — which is why editing the business name or the 24-hour
  // toggle appeared to have no effect on the review step.
  function isMirror(el) {
    return !!el.closest('.js-hidden-mainform, .js-hidden-mirror')
        || el.classList.contains('js-hidden-mirror');
  }

  function snapshotFormValues(root) {
    const data = {};
    root.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.name) return;
      if (el.type === 'file') return;
      if (isMirror(el)) return;   // never let a stale copy win
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    return data;
  }
  function restoreFormValues(root, data) {
    if (!data) return;
    root.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.name) return;
      if (!(el.name in data)) return;
      if (el.type === 'file') return;
      if (isMirror(el)) return;   // mirrors are rebuilt on submit, not restored
      if (el.type === 'checkbox') el.checked = !!data[el.name];
      else if (el.type === 'radio') el.checked = (el.value === data[el.name]);
      else el.value = data[el.name];
    });
  }

  // -----------------------------
  // State
  // -----------------------------
  // Named so inserting a step never means renumbering call sites by hand.
  // Mirrors utils/pricing.js. The server is authoritative — it is what
  // actually takes the credits — but the review step has to show the same
  // number, so any change here needs the same change there.
  // PRICES COME FROM THE SERVER. There is no copy of the price table here.
  //
  // There used to be one, mirroring utils/pricing.js, with a comment saying
  // "any change here needs the same change there". That arrangement is what
  // produced the 400-against-600 bug: two places computing a price are two
  // prices, and they only have to disagree once for a customer to be quoted
  // a number the server will not charge.
  //
  // /api/check-credits already returns the authoritative total and the
  // balance, so everything that shows or gates on a price asks it.

  const credits = {
    total: null,       // what this site costs, per the server
    available: null,   // the customer's balance
    loaded: false,
  };

  // A stale response landing after a newer one would show the wrong total, so
  // each request carries a sequence number and only the newest is applied.
  let quoteSeq = 0;

  /**
   * The service pages as /api/check-credits expects them.
   *
   * Read from the DOM when the pages step is on screen, because state.pages
   * is only synced when the step is left — a row typed thirty seconds ago is
   * in the DOM and not yet in state. Falls back to state everywhere else.
   */
  function currentPageNames() {
    const inputs = document.querySelectorAll('#pagesList .page-row input[type="text"]');
    if (inputs.length) {
      return [...inputs].map(i => i.value.trim()).filter(Boolean);
    }
    return (state.pages || []).filter(Boolean);
  }

  /**
   * The location pages, same rule as above and for the same reason.
   *
   * Reading state.locations here was a bug: it is only written when the step
   * is LEFT, so a location added a moment ago was invisible to the quote —
   * and a location page costs exactly as much as a service page. Someone
   * could add locations past their balance and see no warning at all.
   */
  function currentLocationNames() {
    if (!state.addLocations) return [];

    const inputs = document.querySelectorAll(
      '#locationsList input[name="global[locationPages][]"]:not([type="hidden"])'
    );
    if (inputs.length) {
      return [...inputs].map(i => i.value.trim()).filter(Boolean);
    }
    return (state.locations || []).filter(Boolean);
  }

  /**
   * Ask the server what this site costs.
   *
   * @param {number} extraPages  price as if this many more pages existed,
   *                             which is how the Add page button knows
   *                             whether the next one is affordable.
   * @returns {Promise<{totalCost:number, available:number, affordable:boolean}>}
   */
  async function fetchQuote({ extraPages = 0, extraLocations = 0 } = {}) {
    const names = currentPageNames();

    const pages = {};
    names.forEach((name, i) => { pages[`pages[${i}][filename]`] = name; });

    // Named rather than blank: checkCredits counts keys, and a blank value
    // would be indistinguishable from a row the customer has not filled in.
    for (let n = 0; n < extraPages; n++) {
      pages[`pages[${names.length + n}][filename]`] = `page-${names.length + n + 1}`;
    }

    const csrf = document
      .querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

    const res = await fetch('/api/check-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        pages,
        siteMode: state.siteMode,
        locationPages: currentLocationNames().length + extraLocations,
      }),
    });

    if (!res.ok) throw new Error('Could not price this site');

    const data = await res.json();

    // Affordability is computed here rather than read from data.ok, because
    // checkCredits also returns ok:false when there are no service pages yet
    // — which is a different thing from "cannot afford it", and would make an
    // empty form look like a money problem.
    return {
      totalCost: Number(data.totalCost) || 0,
      available: Number(data.available) || 0,
      affordable: (Number(data.available) || 0) >= (Number(data.totalCost) || 0),
    };
  }

  /** Refresh the cached figures. Never throws; a blip leaves the last good value. */
  async function refreshCredits(opts = {}) {
    const seq = ++quoteSeq;
    try {
      const q = await fetchQuote(opts);
      if (seq !== quoteSeq) return null;   // superseded
      credits.total = q.totalCost;
      credits.available = q.available;
      credits.loaded = true;
      return q;
    } catch (_) {
      return null;
    }
  }

  /** The total, or a placeholder while the first request is in flight. */
  function creditsLabel() {
    return credits.loaded ? credits.total.toLocaleString() : '…';
  }

  /**
   * The "not enough credits" modal.
   *
   * Delegates to the one spinner.js publishes, so the sentence a customer
   * reads is written once. A local copy here is how this file ended up with
   * its own price table.
   */
  /* ------------------------------------------------------------------
   * The draft
   * ------------------------------------------------------------------
   * Pressing "Buy Credits" navigates away, and coming back used to mean an
   * empty form — every field retyped to reach the same wall.
   *
   * Saved to sessionStorage rather than the server: it is a half-finished
   * form, not data anyone owns, and it should disappear when the tab does.
   * It survives the round trip through Stripe because sessionStorage is per
   * tab, not per page.
   *
   * THE LOGO CANNOT BE SAVED. Browsers do not allow JavaScript to set a file
   * input's value — a page that could would be a page that can steal files.
   * So the restore notice says so plainly, rather than letting someone submit
   * and be told a logo is required.
   * ---------------------------------------------------------------- */

  const DRAFT_KEY = 'wizardDraft.v1';

  function saveDraft() {
    try {
      // Everything except the File and its blob URL, which do not survive a
      // navigation in any form.
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        siteMode: state.siteMode,
        styleKey: state.styleKey,
        businessType: state.businessType,
        logoType: state.logoType,
        mainFormSnapshot: state.mainFormSnapshot,
        pages: currentPageNames(),
        addLocations: state.addLocations,
        locations: currentLocationNames(),
      }));
    } catch (_) {
      // Private browsing, or storage full. Losing a draft is a nuisance;
      // throwing here would break the form.
    }
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;

      const draft = JSON.parse(raw);

      // An hour. Long enough to buy credits and come back, short enough that
      // yesterday's abandoned attempt does not reappear as a surprise.
      if (!draft || Date.now() - (draft.savedAt || 0) > 60 * 60 * 1000) {
        sessionStorage.removeItem(DRAFT_KEY);
        return null;
      }

      return draft;
    } catch (_) {
      return null;
    }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {}
  }

  // Published so spinner.js can save before it shows the credits modal. That
  // modal appears on TWO paths — the Add page gate here, and a rejected
  // submit over there — and only one of them lives in this file.
  window.ieSaveDraft = saveDraft;

  function applyDraft(draft) {
    state.siteMode = draft.siteMode || state.siteMode;
    state.styleKey = draft.styleKey || state.styleKey;
    state.businessType = draft.businessType || '';
    state.logoType = draft.logoType || state.logoType;
    state.mainFormSnapshot = draft.mainFormSnapshot || null;
    state.pages = Array.isArray(draft.pages) ? draft.pages : [];
    state.addLocations = draft.addLocations !== false;
    state.locations = Array.isArray(draft.locations) ? draft.locations : [];
  }

  /** Tells the customer what came back, and what did not. */
  function showDraftNotice() {
    const host = document.getElementById('dynamicFormContainer');
    if (!host) return;

    // Colours are set INLINE, not left to Bootstrap's alert classes.
    //
    // The page paints text white to sit on its dark background, and that rule
    // reaches inside the alert — so <strong> came out white on a pale panel
    // and was nearly unreadable. An inline style is the one thing a stylesheet
    // cannot override, which is what this needs.
    const note = el('div', {
      class: 'alert alert-dismissible fade show',
      role: 'alert',
      style: 'background:#d1e7dd;border:1px solid #a3cfbb;color:#0a3622;',
    });
    note.innerHTML = `
      <strong style="color:#0a3622;">Your details were kept.</strong>
      <span style="color:#0a3622;">
        Everything you entered is still here — you will need to choose your logo
        again, because browsers do not let a page refill a file field.
      </span>
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    host.parentNode.insertBefore(note, host);
  }

  function showCreditsModal(quote) {
    // The draft is saved inside the modal itself, so every path that shows it
    // saves — not just this one.
    if (typeof window.ieShowCreditsModal === 'function') {
      window.ieShowCreditsModal(quote);
      return;
    }
    // spinner.js failed to load, so nothing else will save the draft.
    saveDraft();
    window.alert(
      `This website needs ${quote.totalCost} credits and you have ${quote.available}.`
    );
  }

  const STEP = {
    MODE:   0,
    TYPE:   1,
    LOGO:   2,
    DESIGN: 3,
    MAIN:   4,
    PAGES:  5,
    REVIEW: 6,
  };

  /**
   * The visible number for a step, e.g. "3. Design & Theme".
   *
   * Derived from STEP rather than typed into each heading, so inserting a
   * step renumbers everything automatically. The main form already read
   * "1. Global Information" — a hardcoded 1 that was wrong the moment the
   * site-mode step went in front of it.
   */
  /**
   * Full-size preview over a dark backdrop.
   *
   * The old Preview button opened the raw image in a new tab, which lost the
   * user's place in the wizard and looked broken on mobile. This keeps them
   * where they are.
   *
   * Built and destroyed on demand rather than left in the DOM: the wizard
   * repaints its container constantly, and a persistent overlay would be
   * wiped out by the next step render.
   */
  function openLightbox(src, label) {
    const existing = document.getElementById('designLightbox');
    if (existing) existing.remove();

    const box = document.createElement('div');
    box.id = 'designLightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', `${label} preview`);
    box.style.cssText = `
      position:fixed; inset:0; z-index:20000;
      background:rgba(0,0,0,.88);
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      padding:24px; cursor:zoom-out;
    `;

    box.innerHTML = `
      <p class="text-white mb-2">${label}</p>
      <img src="${src}" alt="${label} preview"
           style="max-width:min(1100px, 95vw); max-height:82vh; object-fit:contain;
                  border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,.6);">
      <p class="text-white-50 small mt-3 mb-0">Click anywhere, or press Escape, to close</p>
    `;

    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey);
      // Restore scrolling — without this the page stays locked after closing.
      document.body.style.overflow = '';
    };

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };

    box.addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    // Stop the page behind scrolling while the overlay is open.
    document.body.style.overflow = 'hidden';
    document.body.appendChild(box);
  }

  function stepNumber(step) {
    return step + 1;
  }

  const state = {
   // 'rankfast' = Rank Fast, the new formats. 'lead' = Rank GBPs, the full
    // optimised site as it has always been built. 'sample' = a one-page
    // design sample for showing a prospective client, with no service,
    // location or legal pages and no pricing or FAQ section.

    siteMode: 'rankfast',
    styleKey: 'style',
    businessType: '',
    logoType: 'square',     // 'square' | 'rect'
    logoFile: null,
    logoPreviewURL: '',
    mainFormSnapshot: null, // snapshot of main form fields

    // Final step data
    pages: [],            // service pages strings 
    addLocations: true,   // toggle default ON
    locations: [],        // array of strings

    // The replies from /api/suggest-services, newest last, so stepping back
    // to this step shows the same lists instead of paying for another model
    // call. Capped at MAX_SUGGESTION_BATCHES.
    suggestionBatches: [],

    // Which business type those batches were asked for. When it changes they
    // are thrown away, because a plumber's services are wrong for a dentist.
    suggestionsFor: ''
  };

  // DOM refs
  let container, form, hiddenLogoInput;

  // -----------------------------
  // Shared nav renderer
  // -----------------------------
  function renderNav(container, { showBack = false, nextText = 'Next', backText = 'Back', onBack, onNext } = {}) {
    const nav = el('div', { class: 'd-flex gap-2 mt-4 justify-content-between flex-wrap' });
    const back = el('button', {
      type: 'button',
      id: 'backBtn',
      class: 'btn',
      style: `background:#148ec6;color:#fff;min-width:150px;font-size:18px;display:${showBack ? 'inline-block' : 'none'}`
    }, backText);
    const next = el('button', {
      type: 'button',
      id: 'nextBtn',
      class: 'btn btn-success ms-auto',
      style: 'min-width:150px;font-size:18px;'
    }, nextText);
    nav.append(back, next);
    container.appendChild(nav);

    if (onBack) back.addEventListener('click', onBack);
    if (onNext) next.addEventListener('click', onNext);
    return { back, next };
  }

  // -----------------------------
  // Step 0: What are we building?
  // -----------------------------
  /**
   * The site modes, in display order.
   *
   * A list rather than hardcoded markup: two more are planned, and adding
   * one should mean adding an entry here, not editing the template and
   * renumbering the labels by hand.
   */
  
  const SITE_MODES = [
    {
      value: 'rankfast',
      title: 'Rank Fast',
      description: 'Built fully SEO-optimized to rank fast and generate leads without a GBP',
    },
    {
      value: 'sample',
      title: 'One-Page Design',
      description: 'Built to pitch clients a new web design',
    },
    {
      // 'lead' is the ORIGINAL full-site mode, relabelled. The value stays
      // exactly as it is: every existing Job record and content.json holds
      // it, and renaming it would mean migrating all of them for a wizard
      // caption. utils/seoPresets.js keys the old formats off this value.
      value: 'lead',
      title: 'Rank GBPs',
      description: 'Optimised to rank an existing Google Business Profile',
    },
  ];


  // ---------------------------------------------------------------------
  // Business types, and the trust claims each kind of business may make.
  //
  // MIRRORS utils/businessShape.js. It has to live here as well because the
  // form is a real multipart POST carrying an uploaded logo, so the wizard
  // cannot ask the server what to render without either a second round trip
  // or losing the file input.
  //
  // Two copies is where drift lives, so test-business-shape.js reads these
  // three constants back OUT of this file and asserts they match the registry
  // exactly. Add a business type on the server and this fails until it is
  // added here too.
  // ---------------------------------------------------------------------

  var BUSINESS_TYPE_LABELS = [
    "Plumbing",
    "Fencing",
    "Painter",
    "Paving",
    "Swimming Pool Contractor",
    "Junk Removal",
    "Appliance Repair",
    "Water Damage Restoration",
    "Tree Removal",
    "Electrician",
    "Concrete Contractor",
    "French Drain Installation",
    "Roofing",
    "HVAC",
    "Air Conditioning",
    "Landscaping",
    "Dentist",
    "Doctor",
    "Chiropractor",
    "Physical Therapy",
    "Lemon Law",
    "Web Design",
    "Coding"
  ];

  var BUSINESS_TYPE_SHAPES = {
    "Plumbing": "home",
    "Fencing": "home",
    "Painter": "home",
    "Paving": "home",
    "Swimming Pool Contractor": "home",
    "Junk Removal": "home",
    "Appliance Repair": "home",
    "Water Damage Restoration": "home",
    "Tree Removal": "home",
    "Electrician": "home",
    "Concrete Contractor": "home",
    "French Drain Installation": "home",
    "Roofing": "home",
    "HVAC": "home",
    "Air Conditioning": "home",
    "Landscaping": "home",
    "Dentist": "medical",
    "Doctor": "medical",
    "Chiropractor": "medical",
    "Physical Therapy": "medical",
    "Lemon Law": "professional",
    "Web Design": "project",
    "Coding": "project"
  };

  // Claim-bearing trust points, by shape. Anything NOT ticked here is never
  // offered to the model, so an unticked claim cannot appear on the page.
  // "Open 24 hours" is deliberately absent: it is already driven by the Open
  // 24 Hours toggle further down this same step.
  var TRUST_CLAIMS_BY_SHAPE = {
    "home": [
      {"id": "cards", "label": "Visa, Mastercard and most major cards accepted", "default": true},
      {"id": "licensed", "label": "licensed, insured and bonded", "default": true},
      {"id": "accredited", "label": "accredited by local authorities", "default": true},
      {"id": "fiveStar", "label": "5-star rated by local customers", "default": true},
      {"id": "sameDay", "label": "same-day service available", "default": true},
      {"id": "estimates", "label": "free onsite estimates", "default": true},
      {"id": "warranty", "label": "workmanship warranty", "default": true},
      {"id": "upfront", "label": "upfront pricing, no hidden fees", "default": true},
      {"id": "familyOwned", "label": "family owned and operated", "default": true}
    ],
    "medical": [
      {"id": "insurance", "label": "most insurance plans accepted", "default": false},
      {"id": "evenings", "label": "evening and Saturday appointments", "default": false},
      {"id": "sameWeek", "label": "same-week appointments available", "default": false},
      {"id": "emergency", "label": "emergency appointments available", "default": false},
      {"id": "financing", "label": "payment plans and financing available", "default": false},
      {"id": "parking", "label": "free parking and step-free access", "default": false},
      {"id": "licensed", "label": "licensed and state-registered", "default": false},
      {"id": "family", "label": "family and children's care welcome", "default": false},
      {"id": "cards", "label": "Visa, Mastercard and most major cards accepted", "default": false}
    ],
    "professional": [
      {"id": "freeConsult", "label": "free initial consultation", "default": false},
      {"id": "licensed", "label": "licensed to practice in this state", "default": false},
      {"id": "evenings", "label": "evening and weekend consultations", "default": false},
      {"id": "plans", "label": "payment plans available", "default": false},
      {"id": "spanish", "label": "se habla espa\u00f1ol", "default": false},
      {"id": "contingency", "label": "no fee unless we recover", "default": false, "note": "Most states require a costs disclaimer alongside this claim. Check your bar rules before enabling it."}
    ],
    "project": [
      {"id": "freeDiscovery", "label": "free discovery call", "default": false},
      {"id": "fixedPrice", "label": "fixed-price proposals, no hourly surprises", "default": false},
      {"id": "accessible", "label": "mobile-first, accessible builds", "default": false},
      {"id": "support", "label": "ongoing support and maintenance available", "default": false},
      {"id": "noContract", "label": "no long-term contracts", "default": false},
      {"id": "cards", "label": "Visa, Mastercard and most major cards accepted", "default": false}
    ],
    "generic": [
      {"id": "freeConsult", "label": "free initial consultation", "default": false},
      {"id": "cards", "label": "Visa, Mastercard and most major cards accepted", "default": false},
      {"id": "evenings", "label": "evening and weekend availability", "default": false}
    ]
  };

  function shapeForType(label) {
    return BUSINESS_TYPE_SHAPES[label] || 'generic';
  }

  /**
   * Draw the trust claim checkboxes for the chosen business type and keep the
   * hidden global[trustClaims] field in step with them.
   *
   * On a first visit the shape's defaults decide what is ticked — every
   * historical claim for home services, nothing for anyone else. On a return
   * visit the hidden field wins, so an owner who deliberately unticked
   * something does not find it ticked again.
   */
  function renderTrustClaims(container, form) {
    const list   = container.querySelector('#trustClaimsList');
    const hidden = container.querySelector('#trustClaims');
    if (!list || !hidden) return;

    const shape  = shapeForType(state.businessType);
    const claims = TRUST_CLAIMS_BY_SHAPE[shape] || TRUST_CLAIMS_BY_SHAPE.generic;

    // '' means "never posted" — a first visit. An explicit list means the
    // owner has been here, and an EMPTY explicit list is a real answer
    // (nothing is true of us) rather than a missing one, which is why the
    // sentinel below is '-' and not ''.
    const posted = String(hidden.value || '');
    const seen   = posted !== '';
    const ticked = new Set(
      posted === '-' ? [] : posted.split(',').map(s => s.trim()).filter(Boolean)
    );

    list.innerHTML = claims.map((claim, i) => {
      const on = seen ? ticked.has(claim.id) : claim.default;
      return `
          <div class="col-12 col-md-6">
            <div class="form-check">
              <input class="form-check-input js-trust-claim" type="checkbox"
                     id="trustClaim-${i}" data-claim-id="${claim.id}" ${on ? 'checked' : ''}>
              <label class="form-check-label" for="trustClaim-${i}">
                ${claim.label}
              </label>
              ${claim.note ? `<div class="form-text text-warning-emphasis">${claim.note}</div>` : ''}
            </div>
          </div>`;
    }).join('');

    const sync = () => {
      const on = Array.from(list.querySelectorAll('.js-trust-claim'))
        .filter(box => box.checked)
        .map(box => box.getAttribute('data-claim-id'));

      // '-' rather than '': see above. An empty string would read as "the
      // owner has not answered yet" and silently restore the defaults.
      hidden.value = on.length ? on.join(',') : '-';
    };

    list.addEventListener('change', sync);
    sync();
  }

  function renderSiteModeStep() {
    container.innerHTML = '';

    const card = el('div', { class: 'card p-4' });

    const options = SITE_MODES.map((mode, i) => {
      const selected = state.siteMode === mode.value;

      return `
        <div class="col-12">
          <label class="mode-card d-flex gap-3 p-4 rounded border w-100 mb-0
                        ${selected ? ' border-3 border-warning' : 'border-secondary'}"
                 for="siteMode-${mode.value}" style="cursor:pointer;">

            <div class="form-check mb-0">
              <input class="form-check-input" type="radio"
                     name="global[siteMode]" id="siteMode-${mode.value}"
                     value="${mode.value}" ${selected ? 'checked' : ''}>
            </div>

            <div>
              <h4 class="m-0"> ${mode.title}</h4>
              <p class="mb-0 mt-1 text-white-50">${mode.description}</p>
            </div>
          </label>
        </div>`;
    }).join('');

    card.innerHTML = `
      <h4 class="mb-3">${stepNumber(STEP.MODE)}. What are we building?</h4>

      <div class="row g-3">${options}
      </div>
    `;
    container.appendChild(card);

    // Listen to the radios, not the cards. The whole card is a <label>, so
    // clicking anywhere on it already checks the radio — handling the click
    // as well would fire twice and fight the browser's own behaviour.
    card.querySelectorAll('input[name="global[siteMode]"]').forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.siteMode = input.value;
        renderSiteModeStep();   // repaint so the border follows the selection
      });
    });

    renderNav(container, {
      showBack: false,
      nextText: 'Next',
      onNext: () => go(STEP.TYPE),
    });
  }

  // -----------------------------
  // Step 1: Business Type
  // -----------------------------
  function renderBusinessTypeStep() {
    container.innerHTML = '';

    const card = el('div', { class: 'card shadow-sm' });
    card.innerHTML = `
      <div class="card-body">
        <h3 class="card-title mb-2">${stepNumber(STEP.TYPE)}. Choose your Business Type</h3>
        <div class="row g-3">
          <div class="col-12">
            <select class="form-select" id="businessType" required>
              <option value="">Choose...</option>
              ${BUSINESS_TYPE_LABELS
                .map(bt => `<option ${state.businessType===bt?'selected':''}>${bt}</option>`).join('')}
            </select>
            <div class="form-text">You can adjust this later.</div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);

    const select = card.querySelector('#businessType');
    select.addEventListener('change', () => select.classList.remove('is-invalid'));

    renderNav(container, {
      // Back to the mode step: this is no longer the first screen, so the
      // user needs a way to change their mind about what they are building.
      showBack: true,
      backText: 'Back',
      onBack: () => go(STEP.MODE),
      nextText: 'Next',
      onNext: () => {
        const val = (select.value || '').trim();
        if (!val) {
          select.classList.add('is-invalid');
          select.focus();
          showAlert(container, 'Please choose a business type.');
          return;
        }
        state.businessType = val;
        go(STEP.LOGO);
      }
    });
  }

  // -----------------------------
  // Step 1: Logo
  // -----------------------------
  function renderLogoStep() {
    container.innerHTML = '';

    const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
    header.innerHTML = `
      <h4 class="m-0"><legend class="form-label mb-2">${stepNumber(STEP.LOGO)}. Choose logo shape &amp; upload</legend></h4>
      <span class="badge text-bg-primary">Business Type: ${state.businessType}</span>
    `;
    container.appendChild(header);

    const wrap = el('div', { class: 'mb-2' });
    wrap.innerHTML = `
      <fieldset class="mb-3">
        <div class="d-flex gap-3 mb-3">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeSquare" value="square" ${state.logoType==='square'?'checked':''}>
            <label class="form-check-label" for="logoTypeSquare"><span class="logo-shape-box" style="width:36px;height:36px;" aria-hidden="true"></span>Square (recommended 250×250 px)</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeRect" value="rect" ${state.logoType==='rect'?'checked':''}>
            <label class="form-check-label" for="logoTypeRect"><span class="logo-shape-box" style="width:47px;height:36px;" aria-hidden="true"></span>Rectangular (recommended 260×200 px)</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeWide" value="wide" ${state.logoType==='wide'?'checked':''}>
            <label class="form-check-label" for="logoTypeWide"><span class="logo-shape-box" style="width:90px;height:36px;" aria-hidden="true"></span>Wide (recommended 500×200 px)</label>
          </div>
        </div>

        <div id="logoSquareWrap" class="mb-3">
          <input type="file" id="logoSquare" class="form-control" accept="image/*">
          <div class="form-text" id="logoSquareHint"></div>
        </div>

        <div id="logoRectWrap" class="mb-3">
          <input type="file" id="logoRect" class="form-control" accept="image/*">
          <div class="form-text" id="logoRectHint"></div>
        </div>

        <div id="logoWideWrap" class="mb-3">
          <input type="file" id="logoWide" class="form-control" accept="image/*">
          <div class="form-text" id="logoWideHint"></div>
        </div>

        <div id="logoPreview" class="mt-3" style="display:none;">
          <div class="form-text mb-1"><strong></strong> <span id="logoFileName"></span></div>
          <img id="logoImgPreview" alt="Logo preview" style="max-height:120px; max-width:260px; display:block;">
        </div>
      </fieldset>
    `;
    container.appendChild(wrap);

    const radios = container.querySelectorAll('input[name="logoTypeStep"]');
    radios.forEach(r => r.addEventListener('change', () => applyLogoTypeForStep(container, r.value)));

    // Wrapper + file input for each logo shape, so adding a shape means
    // adding one entry rather than another branch.
    const LOGO_SHAPES = {
      square: { wrap: '#logoSquareWrap', input: '#logoSquare' },
      rect:   { wrap: '#logoRectWrap',   input: '#logoRect'   },
      wide:   { wrap: '#logoWideWrap',   input: '#logoWide'   },
    };

    function applyLogoTypeForStep(container, type) {
      if (!LOGO_SHAPES[type]) type = 'square';
      state.logoType = type;

      Object.entries(LOGO_SHAPES).forEach(([shape, sel]) => {
        const wrap = container.querySelector(sel.wrap);
        if (wrap) wrap.style.display = shape === type ? '' : 'none';
        container.querySelector(sel.input)?.classList.remove('is-invalid');
      });
    }
    applyLogoTypeForStep(container, state.logoType);

    const squareInput = container.querySelector('#logoSquare');
    const rectInput   = container.querySelector('#logoRect');
    const wideInput   = container.querySelector('#logoWide');
    const squareHint  = container.querySelector('#logoSquareHint');
    const rectHint    = container.querySelector('#logoRectHint');
    const wideHint    = container.querySelector('#logoWideHint');
    const previewWrap = container.querySelector('#logoPreview');
    const previewImg  = container.querySelector('#logoImgPreview');
    const previewName = container.querySelector('#logoFileName');

    // restore chosen file if returning to this step
    if (state.logoFile) {
      const isSquare = state.logoType === 'square';
      const target = isSquare ? squareInput : rectInput;
      if (target) {
        const dt = new DataTransfer();
        dt.items.add(state.logoFile);
        target.files = dt.files;
      }
      if (state.logoPreviewURL) {
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = state.logoFile.name || '(selected)';
      }
    }

    squareInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) {
        state.logoType = 'square';
        state.logoFile = f;
        if (state.logoPreviewURL) URL.revokeObjectURL(state.logoPreviewURL);
        state.logoPreviewURL = URL.createObjectURL(f);
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = f.name || '(selected)';
        // advisoryImageNote(f, 250, 250, squareHint);
        squareInput.classList.remove('is-invalid');
        rectInput?.classList.remove('is-invalid');
      } else { squareHint && (squareHint.textContent = ''); }
    });
    rectInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) {
        state.logoType = 'rect';
        state.logoFile = f;
        if (state.logoPreviewURL) URL.revokeObjectURL(state.logoPreviewURL);
        state.logoPreviewURL = URL.createObjectURL(f);
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = f.name || '(selected)';
        //advisoryImageNote(f, 260, 200, rectHint);
        rectInput.classList.remove('is-invalid');
        squareInput?.classList.remove('is-invalid');
      } else { rectHint && (rectHint.textContent = ''); }
    });

        wideInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) {
        state.logoType = 'wide';
        state.logoFile = f;
        if (state.logoPreviewURL) URL.revokeObjectURL(state.logoPreviewURL);
        state.logoPreviewURL = URL.createObjectURL(f);
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = f.name || '(selected)';
        //advisoryImageNote(f, 260, 200, wideHint);
        rectInput.classList.remove('is-invalid');
        squareInput?.classList.remove('is-invalid');
      } else { wideHint && (wideHint.textContent = ''); }
    });

    renderNav(container, {
      showBack: true,
      nextText: 'Continue',
      onBack: () => go(STEP.TYPE),
      onNext: () => {
        const activeEl = state.logoType === 'square' ? squareInput
                       : state.logoType === 'wide'   ? wideInput
                       : rectInput;
        const file = activeEl?.files?.[0];
        if (!file) {
          activeEl?.classList.add('is-invalid');
          activeEl?.focus();
          showAlert(container, 'Please choose a logo to continue.');
          return;
        }
        state.logoFile = file;
        go(STEP.DESIGN);
      }
    });
  }

  // -----------------------------
  // Step 2: Main Form Theme/Design
  // THEMES already carries a human label ("Design 1"); use it rather than
  // showing the internal filename.
  function logoShapeLabel(key) {
    return ({ square: 'Square', rect: 'Rectangular', wide: 'Wide' })[key] || key || '';
  }

  function themeLabel(key) {
    const theme = THEMES.find(t => t.key === key);
    return theme ? theme.label : key;
  }

  // -----------------------------
  // Duplicate detection
  // -----------------------------
  // Two entries collide when they produce the same FILENAME, so that is what
  // gets compared. Lowercasing and collapsing whitespace — which is what this
  // used to do — asks a different and weaker question: slugify also strips
  // commas and punctuation, so "Drain Cleaning" and "Drain, Cleaning" are two
  // different strings that write to one file, and the second silently
  // overwrites the first. The comment here already claimed slug behaviour;
  // now the code does it.
  //
  // MUST MATCH utils/slugify.js. test-service-names.js reads this function out
  // of this file and runs it against the server's, so the two cannot drift
  // apart unnoticed.
  function normaliseForCompare(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/,/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function findDuplicates(inputs) {
    const seen = new Map();      // normalised -> first input seen
    const dupes = [];            // inputs that repeat an earlier value
    const labels = new Set();

    inputs.forEach(input => {
      const key = normaliseForCompare(input.value);
      if (!key) return;
      if (seen.has(key)) {
        dupes.push(input);
        labels.add(input.value.trim());
        if (!seen.get(key).classList.contains('is-invalid')) {
          dupes.push(seen.get(key));   // highlight the original too
        }
      } else {
        seen.set(key, input);
      }
    });

    return { dupes, labels: [...labels] };
  }

  // -----------------------------
  // Services that are different pages, but arguably the same page
  // -----------------------------
  //
  // A collision above is refused: two names, one file, work destroyed. This is
  // softer. "Water Heater Repair" and "Water Heater Repairs" are two files and
  // two charges, and they compete with each other in search — Google folds
  // near-identical pages together and shows one — so the second is money spent
  // on a page that cannot rank.
  //
  // It only WARNS, because "Water Heater Repair" and "Tankless Water Heater
  // Repair" score as similar and are a perfectly reasonable pair to want. The
  // customer knows their trade; this does not.
  //
  // MIRRORS utils/blog/planCampaign.js — the same comparison the blog engine
  // uses to stop two posts chasing one search. Here rather than on the server
  // because the form is a real multipart POST carrying an uploaded logo: a
  // server-side "are you sure?" would mean sending the file, refusing it, and
  // asking for it again, and browsers cannot refill a file input.
  //
  // test-service-names.js reads these two functions out of this file and runs
  // them against the server's, so a change to one that is not made to the
  // other fails a test rather than quietly disagreeing.
  var COMPARE_STOPWORDS = [
    'a', 'an', 'the', 'my', 'your', 'our', 'is', 'are', 'was', 'be', 'to', 'for',
    'of', 'in', 'on', 'at', 'and', 'or', 'do', 'does', 'did', 'why', 'how',
    'what', 'when', 'where', 'should', 'it', 'that', 'this', 'with', 'from',
    'you', 'i', 'me', 'can', 'will', 'get', 'got', 'so', 'if', 'vs'
  ];

  function compareTokens(value) {
    var stop = {};
    COMPARE_STOPWORDS.forEach(function (w) { stop[w] = true; });

    var seen = {};
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(function (w) { return w.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''); })
      .forEach(function (w) { if (w && !stop[w]) { seen[w] = true; } });

    return Object.keys(seen);
  }

  // Jaccard overlap, plus subset containment — "Leak Detection" inside
  // "Slab Leak Detection" is the common shape and does not always clear 0.6.
  function findSimilarPairs(values, threshold) {
    var limit = typeof threshold === 'number' ? threshold : 0.6;
    var pairs = [];

    var tokenised = values.map(function (v) { return { value: v, tokens: compareTokens(v) }; })
                          .filter(function (t) { return t.tokens.length; });

    for (var i = 0; i < tokenised.length; i++) {
      for (var j = i + 1; j < tokenised.length; j++) {
        var a = tokenised[i].tokens;
        var b = tokenised[j].tokens;

        var shared = a.filter(function (t) { return b.indexOf(t) !== -1; }).length;
        var union = a.concat(b.filter(function (t) { return a.indexOf(t) === -1; })).length;
        var score = union ? shared / union : 0;

        var subset = (shared === a.length) || (shared === b.length);

        if (subset || score >= limit) {
          pairs.push([tokenised[i].value, tokenised[j].value]);
        }
      }
    }

    return pairs;
  }

  // -----------------------------
  // Context badges
  // -----------------------------
  // Shown on every step after the main form so the user can see what they are
  // building without going back. Values come from the step-3 snapshot, since
  // the main form fields are not in the DOM on later steps.
  function snapshotValue(key) {
    const snap = state.mainFormSnapshot;
    if (!snap) return '';
    const v = snap[`global[${key}]`];
    return (v === undefined || v === null) ? '' : String(v).trim();
  }

  function contextBadges(extra = []) {
    const businessName = snapshotValue('businessName');
    const location     = snapshotValue('location');

    // Deliberately just these four. Logo filename and domain added noise
    // without helping anyone decide what to type next; the review step
    // shows the full picture.
    const badges = [];
    if (businessName) badges.push(['text-bg-light text-dark', `Business: ${businessName}`]);
    if (state.businessType) badges.push(['text-bg-primary', `Type: ${state.businessType}`]);
    if (location) badges.push(['text-bg-success', `Location: ${location}`]);
    badges.push(['text-bg-info', themeLabel(state.styleKey)]);

    extra.forEach(b => badges.push(b));

    return badges
      .map(([cls, text]) => `<span class="badge ${cls}">${escapeHtml(text)}</span>`)
      .join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // -----------------------------
  function renderMainForm() {
    container.innerHTML = '';

    const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
    header.innerHTML = `
      <h4 class="m-0">${stepNumber(STEP.MAIN)}. Global Information</h4>
      <div class="d-flex flex-wrap gap-2">${contextBadges()}</div>
    `;
    container.appendChild(header);

    const block = el('div');
    block.innerHTML = `
      <input type="hidden" name="global[businessType]" value="${state.businessType}">

      <div class="mb-4">
        <!-- Business Name-->
        <div class="mb-3">
          <label class="form-label">Business Name</label>
          <input type="text" name="global[businessName]" class="form-control" required />
        </div>


        <!-- Domain -->
        <div class="mb-3">
          <label class="form-label">Domain</label>
          <input type="text" name="global[domain]" class="form-control" placeholder="example.com" required />
        </div>

        <!-- Address -->
        <div class="mb-3">
          <label class="form-label">Address</label>
          <input type="text" name="global[address]" class="form-control" required />
        </div>

        <!-- Owner / founder name. A design sample is not a real business
             page, so an invented owner would be noise. -->
        <div class="mb-3" ${state.siteMode === 'sample' ? 'style="display:none;"' : ''}>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="includeOwner" name="global[includeOwner]">
            <label class="form-check-label" for="includeOwner">
              Include an owner or founder name on the About page
            </label>
          </div>

          <div id="ownerNameWrap" class="mt-2" style="display:none;">
            <input type="text" name="global[ownerName]" class="form-control"
                   placeholder="e.g. Marcus Delgado">
            <div class="form-text">
              Leave blank and we'll create a name that suits the area.
            </div>
          </div>
        </div>

        <!-- Main Location-->
        <div class="mb-3">
          <label class="form-label">Main Location</label>
          <input type="text" name="global[location]" class="form-control" required />
        </div>


        <!-- Phone -->
        <!--
          type="tel" validates NOTHING. Unlike type="email", a browser accepts
          any string in a tel input, so "call me" satisfied the required
          attribute and
          generated a whole site with that text in every title, every meta
          description and every click-to-call link.

          The placeholder shows the expected shape. The actual check is
          isPhoneLike() in the step validator below, backed by
          isDialablePhone() on the server, which is the one that counts.
        -->
        <div class="mb-3">
          <label class="form-label">Phone</label>
          <input type="tel" name="global[phone]" class="form-control"
                 placeholder="(512) 894-6167" required />
        </div>


        <!-- Email-->
        <div class="mb-3">
          <label class="form-label">Email</label>
          <input type="email" name="global[email]" class="form-control" required />
        </div>


         <!-- Google Map CID. Feeds the LocalBusiness schema, so it has no
              purpose in a design sample. -->
        <div class="mb-3 mt-3" ${state.siteMode === 'sample' ? 'style="display:none;"' : ''}>
          <label class="form-label" for="googleMapCid">Google Map CID</label>
        <input type="text"
                id="googleMapCid"
                name="global[googleMapCid]"
                class="form-control"
                placeholder="e.g. 12345678901234567890" />
        <div class="form-text">
          Optional. Paste the Google Business CID if you have it.
        </div>
        </div>

        <hr>

        <div class="form-check mt-2">
          <input class="form-check-input" type="checkbox" id="showAboutForm" name="global[showAboutForm]" checked>
          <label class="form-check-label" for="showAboutForm">
            Include contact form on About page
          </label>
        </div>

        <hr>

        <!-- Near Me. Hidden for design samples, and unchecked so the
             near-me section is not generated at all. -->
        <div class="form-check" ${state.siteMode === 'sample' ? 'style="display:none;"' : ''}>
          <input class="form-check-input" type="checkbox" id="useNearMe" name="global[useNearMe]" value="true"
                 ${state.siteMode === 'sample' ? '' : 'checked'}>
          <label class="form-check-label" for="useNearMe">
            Check to optimize About Us page with "Near Me" term
          </label>
        </div>

        <hr>


        <!-- What this business can claim.
             Everything here is a statement of FACT about the business, so the
             owner ticks what is true rather than the generator asserting it.
             Home services arrive pre-ticked, which is what the page said
             before this existed; every other kind of business starts empty.
             Nothing unticked is ever offered to the model. -->
        <div class="mb-3" id="trustClaimsBlock">
          <label class="form-label">What can this business claim?</label>
          <div class="form-text mb-2">
            Only tick what is actually true. These appear on the About page as
            statements of fact, and anything left unticked is never written.
          </div>
          <input type="hidden" id="trustClaims" name="global[trustClaims]" value="">
          <div class="row g-2" id="trustClaimsList"></div>
        </div>

        <hr>


        <!-- Business Hours-->
        <div class="mb-3">
          <label class="form-label">Business Hours</label>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="is24Hours" name="global[is24Hours]">
            <label class="form-check-label" for="is24Hours">Open 24 Hours</label>
          </div>
        </div>

        <div id="hoursContainer">
          ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => `
            <div class="row mb-2 align-items-center">
              <div class="col-sm-2"><strong>${day}</strong></div>
              <div class="col-sm-3">
                <input type="time" class="form-control"
                  name="global[hours][${day.toLowerCase()}][open]"
                  data-open-for="${day.toLowerCase()}">
              </div>
              <div class="col-sm-3">
                <input type="time" class="form-control"
                  name="global[hours][${day.toLowerCase()}][close]"
                  data-close-for="${day.toLowerCase()}">
              </div>
              <div class="col-sm-4">
                <div class="form-check">
                  <input class="form-check-input day-closed" type="checkbox"
                    id="closed-${day.toLowerCase()}"
                    name="global[hours][${day.toLowerCase()}][closed]"
                    value="true"
                    data-day="${day.toLowerCase()}">
                  <label class="form-check-label" for="closed-${day.toLowerCase()}">Closed</label>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <hr>

        <!-- Social Profiles-->
        <label class="form-label">Social Profiles</label>
        ${['facebookUrl','twitterUrl','linkedinUrl','youtubeUrl','instagramUrl','pinterestUrl'].map(field => `
          <div class="mb-3">
            <label class="form-label">${field.replace('Url','').replace(/([A-Z])/g,' $1')} URL</label>
            <input type="url" name="global[${field}]" class="form-control" />
          </div>
        `).join('')}

        <hr>

        <div class="mb-3">
          <label for="youtubeVideoUrl" class="form-label">
            Provide a YouTube video URL (optional)
          </label>
          <input
            type="url"
            class="form-control"
            id="youtubeVideoUrl"
            name="global[youtubeVideoUrl]"
            placeholder="https://www.youtube.com/watch?v=XXXXXXXXXXX"
          >
          <div class="form-text">
            Paste a full YouTube link. This video will show on the About / Home page.
          </div>
        </div>



      </div>
    `;
    container.appendChild(block);

    // Footer: Back/Next (Next validates)
    const footer = el('div', { class: 'd-flex gap-2 mt-4' });
    const backBtn = el('button', { type: 'button', class: 'btn', style: 'background:#148ec6;color:#fff;min-width:150px;font-size:18px;' }, 'Back');
    const resetBtn = el('button', { type: 'button', class: 'btn btn-warning', style: 'min-width:150px;font-size:18px;margin-left:20px' }, 'Start Over');

    const nextBtn = el('button', { type: 'button', class: 'btn btn-success ms-auto', style: 'min-width:150px;font-size:18px;' }, 'Continue');
    footer.append(backBtn, resetBtn, nextBtn);
    container.appendChild(footer);
    resetBtn.addEventListener('click', startOver);

    // Drop any mirrors left over from a previous pass through the wizard.
    // They are rebuilt from state when the user moves forward again.
    form.querySelectorAll('.js-hidden-mainform, .js-hidden-mirror').forEach(n => n.remove());

    // Restore any previously typed main-form values
    restoreFormValues(form, state.mainFormSnapshot);

    // Hours hookup (from hoursOfOperation.js)
    if (window.attachHours) window.attachHours();

    // Trust claims. Built from the business type chosen back on the type step,
    // so a dentist is never shown "workmanship warranty" — it is not in their
    // shape's list at all.
    //
    // Rendered AFTER restoreFormValues, because the boxes do not exist until
    // this runs and the snapshot carries only the hidden field. The hidden
    // field is the single source of truth for what gets posted: a checkbox
    // array arrives nested through one body parser and flat through another,
    // and this route already carries a `body.global?.x ?? body['global[x]']`
    // dance because of exactly that.
    renderTrustClaims(container, form);

    // Owner name field: only shown when the box is ticked. Runs after
    // restoreFormValues so a previously ticked box reopens with its value.
    const ownerToggle = container.querySelector('#includeOwner');
    const ownerWrap   = container.querySelector('#ownerNameWrap');

    if (ownerToggle && ownerWrap) {
      const syncOwner = () => {
        ownerWrap.style.display = ownerToggle.checked ? '' : 'none';
      };
      syncOwner();
      ownerToggle.addEventListener('change', syncOwner);
    }

    // Remove red outline when user fixes input (text/time/checkbox)
    container.addEventListener('input', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    });
    container.addEventListener('change', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    });

    backBtn.addEventListener('click', () => {
      state.mainFormSnapshot = snapshotFormValues(form);
      go(STEP.DESIGN);
    });

    nextBtn.addEventListener('click', () => {
      // Validate required text/email/tel fields
      const requiredFields = [
        'global[businessName]',
        'global[domain]',
        'global[address]',
        'global[location]',
        'global[phone]',
        'global[email]'
      ];
      const inputs = requiredFields.map(name => container.querySelector(`[name="${name}"]`));

      /**
       * Ten digits, or eleven starting with 1 — the same rule as
       * isDialablePhone() in utils/helpers.js.
       *
       * Deliberately duplicated rather than shared: this file is served to the
       * browser and helpers.js is not, and a build step to share one function
       * is not worth it for four lines. The SERVER is the authority; this only
       * saves the customer a round-trip. If the rule changes, change both —
       * test-phone.js asserts they agree by reading this file.
       */
      const isPhoneLike = (value) => {
        const digits = String(value || '').replace(/\D/g, '');
        return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
      };

      let firstInvalid = null;
      let phoneBadFormat = false;

      inputs.forEach(input => {
        if (!input) return;
        const val = String(input.value || '').trim();
        let ok = input.checkValidity() && val !== '';

        // type="tel" accepts any string, so checkValidity() passes "call me".
        if (ok && input.getAttribute('name') === 'global[phone]' && !isPhoneLike(val)) {
          ok = false;
          phoneBadFormat = true;
        }

        if (!ok) {
          if (!firstInvalid) firstInvalid = input;
          input.classList.add('is-invalid');
        } else {
          input.classList.remove('is-invalid');
        }
      });

      // A filled-but-malformed phone needs its own message: "Please fill out
      // Phone" is wrong and confusing when the box visibly has something in it.
      if (phoneBadFormat && firstInvalid?.getAttribute('name') === 'global[phone]') {
        firstInvalid.focus();
        showAlert(container, 'Enter a 10-digit phone number, e.g. (512) 894-6167.');
        return;
      }

      if (firstInvalid) {
        firstInvalid.focus();
        const labels = {
          'global[businessName]': 'Business Name',
          'global[domain]': 'Domain',
          'global[address]': 'Address',
          'global[location]': 'Main Location',
          'global[phone]': 'Phone',
          'global[email]': 'Email'
        };
        const name = firstInvalid.getAttribute('name');
        showAlert(container, `Please fill out ${labels[name] || 'all required fields'}.`);
        return;
      }

      // ===== Business Hours validation =====
      const is24 = container.querySelector('#is24Hours')?.checked;
      if (!is24) {
        const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        let hoursValid = true;
        let firstInvalidHoursControl = null;

        for (const day of days) {
          const openEl  = container.querySelector(`[name="global[hours][${day}][open]"]`);
          const closeEl = container.querySelector(`[name="global[hours][${day}][close]"]`);
          const closedEl = container.querySelector(`#closed-${day}`);

          const isClosed = !!closedEl?.checked;
          const openVal = (openEl?.value || '').trim();
          const closeVal = (closeEl?.value || '').trim();

          // Rule: for EACH day, either mark Closed OR provide BOTH open & close times.
          if (!isClosed) {
            if (!openVal || !closeVal) {
              hoursValid = false;
              openEl?.classList.add('is-invalid');
              closeEl?.classList.add('is-invalid');
              if (!firstInvalidHoursControl) firstInvalidHoursControl = openEl || closeEl;
            } else {
              openEl?.classList.remove('is-invalid');
              closeEl?.classList.remove('is-invalid');
            }
          } else {
            openEl?.classList.remove('is-invalid');
            closeEl?.classList.remove('is-invalid');
          }
        }

        if (!hoursValid) {
          firstInvalidHoursControl?.focus();
          showAlert(container, 'Please complete Business Hours: for each day, either enter BOTH Open & Close times or check "Closed". Or turn on "Open 24 Hours".');
          return;
        }
      }

      // All good — snapshot and move on
      state.mainFormSnapshot = snapshotFormValues(form);
      go(STEP.PAGES);
    });
  }



  // -----------------------------
  // Step 3 : Service Pages + Location Pages
  // -----------------------------
  function renderPagesAndLocationsStep() {
    container.innerHTML = '';

    const header = el('div', { class: 'mb-3' });
    header.innerHTML = `
      <h4 class="mb-2">${stepNumber(STEP.PAGES)}. Service Pages</h4>
      <div class="d-flex flex-wrap gap-2">${contextBadges()}</div>
    `;
    container.appendChild(header);

    // ===== SERVICE PAGES =====
    const svcWrap = el('div', { class: 'mb-4' });

    // The suggestion panel sits ABOVE the rows, because it is what most
    // people will use to fill them — twenty-five services typed by hand is
    // why most sites here end up with five.
    const suggestWrap = el('div', { id: 'suggestBlock', class: 'mb-3' });
    svcWrap.appendChild(suggestWrap);

    const pagesList = el('div', { id: 'pagesList' });
    svcWrap.appendChild(pagesList);

    const addPageBtn = el('button', { type: 'button', class: 'btn btn-success me-2' }, '+ Add page');
    const svcHint = el('div', { class: 'form-text mt-2' }, 'At least one service page is required.');
    svcWrap.append(addPageBtn, svcHint);
    const hr = el('hr');
    svcWrap.append(hr);

    const addRow = (val='') => addPageRow(pagesList, val);
    if (state.pages.length) state.pages.forEach(p => addRow(p)); else addRow('');

    mountSuggestPanel(suggestWrap, pagesList);

    svcWrap.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('btn-remove-page')) {
        e.preventDefault(); e.stopPropagation();

        const row = e.target.closest('.page-row');

        // A row that came from a ticked box takes the tick with it.
        //
        // Without this the box stays ticked over a row that is gone, and the
        // customer cannot get it back: ticking an already-ticked box fires
        // nothing, so they have to untick and re-tick to work out what
        // happened. The box and the row are two views of one thing and both
        // controls have to say the same thing about it.
        untickSuggestionFor(row);

        row?.remove();
        reindexPageRows(pagesList);
        refreshCredits();
      }
    });
    // THE GATE.
    //
    // Without it, someone with 150 credits can enter ten pages and only find
    // out at the review step — after all the typing. Blocking the click is
    // legitimate in a way that interrupting someone mid-keystroke is not:
    // this fires on a deliberate action, and the action is one that cannot
    // succeed.
    //
    // The price comes from the server, priced as if the new page already
    // existed, so the gate and the review total can never disagree.
    addPageBtn.addEventListener('click', async () => {
      addPageBtn.disabled = true;
      const label = addPageBtn.textContent;
      addPageBtn.textContent = 'Checking…';

      try {
        const q = await fetchQuote({ extraPages: 1 });

        credits.total = q.totalCost;
        credits.available = q.available;
        credits.loaded = true;

        if (!q.affordable) {
          showCreditsModal(q);
          return;
        }
      } catch (_) {
        // A failed check must NOT block the customer. The server checks again
        // before any work is done, so the cost of being wrong here is a
        // rejection later; the cost of blocking is someone unable to use the
        // form because a request blipped.
      } finally {
        addPageBtn.disabled = false;
        addPageBtn.textContent = label;
      }

      addRow('');
    });
    svcWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target?.closest('#pagesList')) e.preventDefault();
    });
    container.appendChild(svcWrap);

    // ===== LOCATION PAGES =====
    const locToggleWrap = el('div', { class: 'form-check form-switch mb-2' });
    locToggleWrap.innerHTML = `
      <input class="form-check-input" type="checkbox"
       id="addLocations"
       name="global[addLocations]"
       value="true"
       ${state.addLocations ? 'checked' : ''}>

      <label class="form-check-label" for="addLocations"><h4>Add location pages</h4></label>
    `;
    container.appendChild(locToggleWrap);

    const locBlock = el('div', { id: 'locationsBlock', class: ' p-3 mb-3' });
    const locList  = el('div', { id: 'locationsList', class: 'mb-2' });
    const addLocBtn = el('button', { type: 'button', class: 'btn btn-sm btn-success', id: 'addLocationBtn' }, '+ Add another location');
    const locHint = el('div', { class: 'form-text mt-2' }, 'Format: City, ST (e.g., Austin, TX). When toggle is ON, at least one location is required.');
    locBlock.append(locList, addLocBtn, locHint);
    container.appendChild(locBlock);

    const locToggle = locToggleWrap.querySelector('#addLocations');
    const ensureVisible = () => locBlock.style.display = locToggle.checked ? 'block' : 'none';
    locToggle.addEventListener('change', ensureVisible);

    // THE LOCATION GATE.
    //
    // A location page costs the same as a service page, so it needs the same
    // guard — an earlier version gated only "Add page", which meant someone
    // could add locations past their balance and hear nothing until the
    // review step.
    //
    // Intercepted in the CAPTURE phase because this button's real handler
    // lives in locationPages.js, which this file does not own. Capture runs
    // first, so stopping here prevents that handler from firing; when the
    // check passes we call its published helper ourselves. Editing the other
    // file would work too, and would leave the gate somewhere nobody looks
    // when they wonder why a page was refused.
    addLocBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      addLocBtn.disabled = true;
      const label = addLocBtn.textContent;
      addLocBtn.textContent = 'Checking…';

      let allowed = true;

      try {
        const q = await fetchQuote({ extraLocations: 1 });

        credits.total = q.totalCost;
        credits.available = q.available;
        credits.loaded = true;

        allowed = q.affordable;
        if (!allowed) showCreditsModal(q);
      } catch (_) {
        // Same rule as the page gate: a failed check must not block the
        // customer. The server checks again before any work is done.
      } finally {
        addLocBtn.disabled = false;
        addLocBtn.textContent = label;
      }

      if (!allowed) return;

      if (window.addLocationInput) {
        window.addLocationInput();
      } else {
        locList.appendChild(el('input', {
          type: 'text', class: 'form-control mb-2', name: 'global[locationPages][]',
        }));
      }
    }, true);   // capture

    const seedLocations = () => {
      locList.innerHTML = '';
      if (state.locations.length) {
        state.locations.forEach(loc => {
          if (window.addLocationInput) {
            window.addLocationInput(loc); // if helper accepts a value
          } else {
            const input = el('input', { type:'text', class:'form-control mb-2', name:'global[locationPages][]', value: loc });
            locList.appendChild(input);
          }
        });
      } else {
        if (window.addLocationInput) window.addLocationInput();
        else locList.appendChild(el('input', { type:'text', class:'form-control mb-2', name:'global[locationPages][]' }));
      }
    };
    ensureVisible(); seedLocations();


    // ===== NAV (Back to Main Form, Submit) =====
    const footer = el('div', { class: 'd-flex gap-2 mt-4' });
    const backBtn = el('button', { type: 'button', class: 'btn', style: 'background:#148ec6;color:#fff;min-width:150px;font-size:18px;' }, 'Back');
    const resetBtn = el('button', { type: 'button', class: 'btn btn-warning', style: 'min-width:150px;font-size:18px;margin-left:20px;' }, 'Start Over');
    const submitBtn = el('button', { type: 'button', class: 'btn btn-success ms-auto btn-submit', style: 'min-width:180px;font-size:18px;' }, 'Review →');
    footer.append(backBtn, resetBtn, submitBtn);
    container.appendChild(footer);

    // Clean and start over
    resetBtn.addEventListener('click', startOver);



    backBtn.addEventListener('click', () => {
      // save current edits in this step
      const pi = container.querySelectorAll('#pagesList input[type="text"]');
      state.pages = [...pi].map(i => i.value.trim()).filter(Boolean);

      const li = container.querySelectorAll('#locationsList input[name="global[locationPages][]"]');
      state.addLocations = !!locToggle.checked;
      state.locations = state.addLocations ? [...li].map(i => i.value.trim()).filter(Boolean) : [];
      go(STEP.MAIN);
    });

    submitBtn.addEventListener('click', () => {
      // capture values
      const pi = container.querySelectorAll('#pagesList input[type="text"]');
      const pagesVals = [...pi].map(i => i.value.trim()).filter(Boolean);

      // Duplicate service pages would overwrite each other's HTML file
      const pageDupes = findDuplicates([...pi]);
      if (pageDupes.dupes.length) {
        [...pi].forEach(i => i.classList.remove('is-invalid'));
        pageDupes.dupes.forEach(i => i.classList.add('is-invalid'));
        pageDupes.dupes[0]?.focus();
        showAlert(container, `Duplicate service page: ${pageDupes.labels.join(', ')}. Each page needs a different name.`);
        return false;
      }

      if (pagesVals.length === 0) {
        pi[0]?.classList.add('is-invalid');
        pi[0]?.focus();
        showAlert(container, 'Please add at least one service page.');
        return;
      }
      const addLoc = !!locToggle.checked;
      const li = container.querySelectorAll('#locationsList input[name="global[locationPages][]"]');
      const locVals = addLoc ? [...li].map(i => i.value.trim()).filter(Boolean) : [];

      // Duplicate cities would produce two location pages with one filename
      if (addLoc) {
        const locDupes = findDuplicates([...li]);
        if (locDupes.dupes.length) {
          [...li].forEach(i => i.classList.remove('is-invalid'));
          locDupes.dupes.forEach(i => i.classList.add('is-invalid'));
          locDupes.dupes[0]?.focus();
          showAlert(container, `Duplicate location: ${locDupes.labels.join(', ')}. Each location needs a different city.`);
          return false;
        }
      }

      if (addLoc && locVals.length === 0) {
        li[0]?.classList.add('is-invalid');
        li[0]?.focus();
        showAlert(container, 'Please add at least one location, or turn off “Add location pages”.');
        return;
      }
      state.pages = pagesVals;
      state.addLocations = addLoc;
      state.locations = locVals;

      // ensure logo mirrored to backend field name="global[logo]"
      if (!state.logoFile) {
        showAlert(container, 'Please choose a logo to continue.');
        go(STEP.LOGO);
        return;
      }
      // ===== ensure logo mirrored to backend field name="global[logo]" =====
      const dt2 = new DataTransfer();
      dt2.items.add(state.logoFile);
      hiddenLogoInput.files = dt2.files;

      // ===== inject hidden inputs for pages/locations (your existing code) =====
      // Clean any old mirrors (defense)
      // Rebuild hidden mirrors every submit (clean first)
      form.querySelectorAll('.js-hidden-mirror, .js-hidden-mainform').forEach(n => n.remove());

      // Only inject pages if page inputs are NOT currently in the DOM (prevents duplicates)
      const hasPageInputsInDom = !!form.querySelector('#pagesList input[name^="pages["]');
      if (!hasPageInputsInDom) {
        const hiddenPagesWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
        state.pages.forEach((p, idx) => {
          hiddenPagesWrap.appendChild(el('input', { type:'hidden', name:`pages[${idx}][filename]`, value:p }));
        });
        form.appendChild(hiddenPagesWrap);
      }

      // Only inject locations if they are NOT currently in the DOM (prevents duplicates)
      const hasLocationInputsInDom = !!form.querySelector('#locationsList input[name="global[locationPages][]"]');
      if (!hasLocationInputsInDom) {
        const hiddenLocWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
        hiddenLocWrap.appendChild(el('input', {
          type:'hidden', name:'global[addLocations]', value: state.addLocations ? 'true' : ''
        }));
        if (state.addLocations) {
          state.locations.forEach(loc => {
            hiddenLocWrap.appendChild(el('input', { type:'hidden', name:'global[locationPages][]', value: loc }));
          });
        }
        form.appendChild(hiddenLocWrap);
      }

      // Inject hidden inputs for the ENTIRE main form (includes hours!), but
      // if 24h is ON, drop per-day hour keys to avoid backend confusion.
      const is24 =
        state.mainFormSnapshot?.['global[is24Hours]'] === true ||
        state.mainFormSnapshot?.['global[is24Hours]'] === 'true';

      injectHiddenSnapshot(
        form,
        state.mainFormSnapshot,
        'js-hidden-mainform',
        (name) => {
          if (STATE_OWNED_FIELDS.includes(name)) return false;
          if (is24 && name.startsWith('global[hours][')) return false;
          return true;
        }
      );



      // === Inject logoType hidden field ===
      let logoTypeHidden = form.querySelector('input[name="global[logoType]"]');
      if (!logoTypeHidden) {
        logoTypeHidden = document.createElement('input');
        logoTypeHidden.type = 'hidden';
        logoTypeHidden.name = 'global[logoType]';
        logoTypeHidden.classList.add('js-hidden-mirror', 'js-hidden-logo-shape'); // so startOver() cleans it
        form.appendChild(logoTypeHidden);
      }

      logoTypeHidden.value = state.logoType; // "square" | "rect" | "wide"

      // === Inject styleKey here too ===
      // The submit handler also sets this, but injecting it now means the
      // review step reflects exactly what will be posted.
      form.querySelectorAll('input[name="global[styleKey]"]').forEach(n => n.remove());
      // Site mode: lead generation or design sample. Decides what the server
      // builds, so it travels with the other state-owned fields.
      form.querySelectorAll('input[name="global[siteMode]"]').forEach(n => n.remove());
      const siteModeEarly = document.createElement('input');
      siteModeEarly.type = 'hidden';
      siteModeEarly.name = 'global[siteMode]';
      siteModeEarly.classList.add('js-hidden-mirror');
      siteModeEarly.value = state.siteMode;
      form.appendChild(siteModeEarly);

      // Business type too, so the review step reflects what will be posted
      form.querySelectorAll('input[name="global[businessType]"]').forEach(n => n.remove());
      const businessTypeEarly = document.createElement('input');
      businessTypeEarly.type = 'hidden';
      businessTypeEarly.name = 'global[businessType]';
      businessTypeEarly.classList.add('js-hidden-mirror');
      businessTypeEarly.value = state.businessType;
      form.appendChild(businessTypeEarly);

      const styleKeyEarly = document.createElement('input');
      styleKeyEarly.type = 'hidden';
      styleKeyEarly.name = 'global[styleKey]';
      styleKeyEarly.classList.add('js-hidden-mirror');
      styleKeyEarly.value = state.styleKey;
      form.appendChild(styleKeyEarly);



      // 🔎 DEBUG: inspect exactly what will be sent
      const dbg = new FormData(form);
      for (const [k, v] of dbg.entries()) {
        console.log(k, v instanceof File ? `(File: ${v.name})` : v);
      }



      // Hidden fields are now in place. Show the review step rather than
      // submitting straight away — generating costs credits, so this is the
      // last chance to catch a typo.
      go(STEP.REVIEW);
    });

    container.addEventListener('input', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    }, { once: true });
  }


  // Step 4: Design and Theme Selection

  function renderDesignStep() {
    container.innerHTML = '';

    // No badge row here: the review step already summarises everything.
    const h = el('h3', {}, `${stepNumber(STEP.DESIGN)}. Design & Theme`);
    const desc = el('p', {}, 'Pick a design. You can preview each one.');
    container.append(h, desc);
  
    const list = el('div', { class: 'row g-3' });

    THEMES.forEach(({ key, label, preview }) => {
      const col = el('div', { class: 'col-md-6 col-lg-4' });
      col.innerHTML = `
        <div class="border rounded p-3 h-100 ${state.styleKey === key ? 'border-success border-3' : 'border-secondary'}"
             style="background:#0b3f7a33;">

          <!-- Clicking the thumbnail opens it full size rather than
               navigating away to the raw image file, which lost the user's
               place in the wizard. -->
          <img src="${preview}" alt="${label} preview" loading="lazy"
               class="img-fluid rounded mb-3 js-design-thumb"
               data-preview="${preview}" data-label="${label}"
               style="cursor:zoom-in; width:100%; aspect-ratio:16/10; object-fit:cover; object-position:top;">

          <div class="form-check">
            <input class="form-check-input" type="radio" name="global[styleKey]"
                   id="theme-${key}" value="${key}"
                   ${state.styleKey === key ? 'checked' : ''} required>
            <label class="form-check-label" for="theme-${key}">${label}</label>
          </div>
        </div>
      `;
      list.appendChild(col);
    });
    container.appendChild(list);

    // Clicking anywhere on a card selects that design — a 3px border is a
    // small target, and the thumbnail is the obvious thing to click.
    list.querySelectorAll('.border.rounded').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('js-design-thumb')) return;  // that opens the lightbox
        const input = card.querySelector('input[type="radio"]');
        if (input && !input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // Update state and repaint so the green border follows the selection.
    // Without this, styleKey is only read when Next is pressed, so the
    // highlight would stay on whichever design was chosen last time.
    list.querySelectorAll('input[name="global[styleKey]"]').forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.styleKey = input.value;
        renderDesignStep();
      });
    });

    list.querySelectorAll('.js-design-thumb').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(img.dataset.preview, img.dataset.label);
      });
    });
  
    const nav = renderNav(container, {
      showBack: true,
      backText: 'Back',
      nextText: 'Next',
      onBack: () => { go(STEP.LOGO); },
      onNext: () => {
        // update state from currently checked radio
        const picked = container.querySelector('input[name="global[styleKey]"]:checked');
        state.styleKey = picked ? picked.value : state.styleKey;
        go(STEP.MAIN); // go to Main Form step
      }
    });
  }

  


  // -----------------------------
  // Pages section helpers (reused)
  // -----------------------------
  function reindexPageRows(container) {
    const rows = container.querySelectorAll('.page-row');
    rows.forEach((row, idx) => {
      const input = row.querySelector('input[type="text"]');
      if (input) input.name = `pages[${idx}][filename]`;
      const lab = row.querySelector('.page-label');
      if (lab) lab.textContent = `Page ${idx + 1}`;
    });
  }
  function addPageRow(container, initialValue = '', opts = {}) {
    const row = el('div', { class: 'row g-2 align-items-end page-row mb-2' });
    row.innerHTML = `
      <div class="col-8">
        <label class="form-label page-label">Pages</label>
        <input type="text" class="form-control" placeholder="service page" required />
      </div>
      <div class="col-4">
        <button type="button" class="btn btn-danger w-100 btn-remove-page">Delete</button>
      </div>
    `;
    container.appendChild(row);
    if (initialValue) row.querySelector('input').value = initialValue;
    reindexPageRows(container);

    // Focus is right when the customer pressed "Add page" and is about to
    // type. It is wrong when eight rows arrive at once from the suggestion
    // list: each one would yank the page down to the newest field while they
    // are still reading the list they just ticked.
    if (opts.focus !== false) row.querySelector('input')?.focus();

    return row;
  }

  /* ------------------------------------------------------------------
   * Suggested service pages
   * ------------------------------------------------------------------
   * A Rank Fast site wants twenty-odd service pages and, until this, every
   * one of them was a row somebody typed. Most people stopped at five —
   * not because five is what their business does, but because the form was
   * long. The site they paid for came out smaller than it should have been.
   *
   * WHY THE TICKED ONES ARE ADDED WITHOUT A CREDIT CHECK
   *
   * Because the server already did it. /api/suggest-services returns how
   * many boxes the balance covers and ticks exactly that many; re-checking
   * each one here would be the same arithmetic done twice, and the second
   * copy is how a quote and a charge drift apart.
   *
   * Every box BELOW that line is still tickable, and ticking one goes
   * through the same gate "Add page" does — the modal, the saved draft, the
   * trip to buy credits. Somebody who wants a ninth page can have it; they
   * are just told the price before they have typed it out.
   * ---------------------------------------------------------------- */

  function pageRowInputs(pagesList) {
    return [...pagesList.querySelectorAll('.page-row input[type="text"]')];
  }

  /**
   * What a tick box and its row share.
   *
   * NOT the text in the field. Matching on that was the first version and it
   * breaks the moment somebody edits a row: rename "Drain Cleaning" to
   * "Drain Cleaning and Jetting" and unticking the box stops finding the row
   * it created. An id survives editing; the words in the field do not.
   */
  function suggestionKey(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function rowForSuggestion(pagesList, key) {
    return key ? pagesList.querySelector(`.page-row[data-suggested="${key}"]`) : null;
  }

  function boxForSuggestion(key) {
    return key ? document.querySelector(`.js-suggested[data-key="${key}"]`) : null;
  }

  /** Clear the tick over a row that is about to be deleted. */
  function untickSuggestionFor(row) {
    const box = boxForSuggestion(row && row.dataset && row.dataset.suggested);
    if (box) box.checked = false;
  }

  /** Fill the blank row if there is one, rather than leaving it stranded. */
  function addOrFillPageRow(pagesList, name, key) {
    const blank = pageRowInputs(pagesList).find(input => !input.value.trim());
    const row = blank
      ? blank.closest('.page-row')
      : addPageRow(pagesList, '', { focus: false });

    const input = row.querySelector('input[type="text"]');
    if (input) input.value = name;
    if (key) row.dataset.suggested = key;

    return row;
  }

  function removePageRow(pagesList, key) {
    const row = rowForSuggestion(pagesList, key);

    if (!row) return;   // they deleted it themselves

    // The form requires at least one service page, so the last row is
    // emptied rather than removed — deleting it would leave the step with no
    // input at all and the customer with nothing to type into.
    if (pageRowInputs(pagesList).length === 1) {
      const input = row.querySelector('input[type="text"]');
      if (input) input.value = '';
      delete row.dataset.suggested;
      return;
    }

    row.remove();
    reindexPageRows(pagesList);
  }

  async function fetchSuggestions() {
    const csrf = document
      .querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

    const res = await fetch('/api/suggest-services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({
        businessType: state.businessType,
        location: (state.mainFormSnapshot || {})['global[location]'] || '',
        siteMode: state.siteMode,
        // Locations and the rows already typed both change what the balance
        // covers, so the server needs them to tick the right number.
        locationPages: currentLocationNames().length,
        existing: currentPageNames(),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Could not suggest services just now.');
    }
    return data;
  }

  /** The line under the list explaining why some boxes are ticked. */
  function budgetNote(checked, total) {
    if (checked >= total && total > 0) {
      return 'Your credits cover all of these. Untick anything you do not want.';
    }
    if (checked === 0) {
      return 'None are ticked because your credits are already spoken for. '
           + 'Tick any you want and we will help you top up.';
    }
    return `The first ${checked} are ticked — that is what your credits cover. `
         + 'Tick more and we will help you top up.';
  }

  /**
   * How many times the suggestion list may be asked for, per business type.
   *
   * Two batches is forty names, which is more than any business has. Past
   * that somebody is browsing rather than building, and each press is a model
   * call that costs money and produces nothing. The remaining services get
   * typed in, which is what the form was always for.
   *
   * This lives in the browser, so it is a decision about the interface and
   * NOT a spending control. The one that binds is suggestServicesLimiter on
   * the server: anyone who can press the button can also call the endpoint
   * directly and ignore this number entirely.
   */
  const MAX_SUGGESTION_BATCHES = 2;

  /** Every suggestion across every batch, as ids. */
  function suggestedKeys(batches) {
    return new Set(
      (batches || []).flatMap(batch =>
        (Array.isArray(batch.services) ? batch.services : []).map(suggestionKey))
    );
  }

  /**
   * Take away the rows that came from a suggestion, keeping what they typed.
   *
   * Used when the business type changes: a list of plumbing services is
   * wrong for an HVAC company, and so are the rows it created. Anything
   * typed by hand stays, because nothing about it has become wrong.
   *
   * It works off the stored batches rather than off the rows' own tags,
   * because this step is rebuilt from scratch every time it is shown — the
   * rows come back from state.pages carrying no tag at all.
   */
  function dropSuggestedRows(pagesList, batches) {
    const keys = suggestedKeys(batches);

    pageRowInputs(pagesList).forEach(input => {
      if (!keys.has(suggestionKey(input.value))) return;

      if (pageRowInputs(pagesList).length === 1) {
        input.value = '';
        delete input.closest('.page-row').dataset.suggested;
        return;
      }
      input.closest('.page-row')?.remove();
    });

    reindexPageRows(pagesList);
  }

  /**
   * One batch of suggestions, as its own block.
   *
   * APPENDED, never replacing what is already on screen. The first version
   * replaced the panel, so pressing the button a second time left the rows
   * from the first batch with no box above them — ticked services the
   * customer could no longer untick. Edwin found that within a day.
   *
   * @param {boolean} fresh  true when this batch has just come back from the
   *   server, false when the step is being rebuilt from what was stored.
   *   Only a fresh batch creates rows; re-rendering one must not resurrect a
   *   row the customer has since unticked.
   */
  function renderBatch(panel, pagesList, data, batchNumber, fresh) {
    const services = Array.isArray(data.services) ? data.services : [];
    const block = el('div', { class: 'mb-2 js-suggest-batch' });
    panel.appendChild(block);

    if (!services.length) {
      block.innerHTML =
        '<div class="form-text">No suggestions came back. Add your services below.</div>';
      return;
    }

    const checked = Math.max(0, Math.min(Number(data.checked) || 0, services.length));

    // Rows first, ticks second. A box is ticked when its service has a row —
    // one rule for both cases, rather than one rule for a fresh batch and
    // another for a restored one.
    if (fresh) {
      services.slice(0, checked).forEach(name => {
        const key = suggestionKey(name);
        const already = pageRowInputs(pagesList)
          .some(input => suggestionKey(input.value) === key);

        if (!already) addOrFillPageRow(pagesList, name, key);
      });
    }

    const items = services.map((name, i) => {
      const key = suggestionKey(name);

      // A service the customer has already typed adopts THEIR row rather
      // than adding a second one, and the row is tagged so the box can
      // control it from here on.
      const mine = pageRowInputs(pagesList)
        .find(input => suggestionKey(input.value) === key);

      if (mine) mine.closest('.page-row').dataset.suggested = key;

      return { name, key, id: `suggest-${batchNumber}-${i}`, onForm: !!mine };
    });

    block.innerHTML = `
      ${batchNumber > 0 ? '<div class="form-text mt-2 mb-1">A few more:</div>' : ''}
      <div class="row row-cols-1 row-cols-md-2 g-2 mb-2">
        ${items.map(({ name, key, id, onForm }) => `
          <div class="col">
            <div class="form-check">
              <input class="form-check-input js-suggested" type="checkbox"
                     id="${id}" value="${escapeHtml(name)}"
                     data-key="${escapeHtml(key)}"
                     ${onForm ? 'checked' : ''}>
              <label class="form-check-label" for="${id}">${escapeHtml(name)}</label>
            </div>
          </div>`).join('')}
      </div>
      ${fresh
        ? `<div class="form-text">${escapeHtml(budgetNote(checked, services.length))}</div>`
        : ''}
    `;

    block.querySelectorAll('.js-suggested').forEach(box => {
      box.addEventListener('change', async () => {
        const name = box.value;
        const key = box.dataset.key;

        if (!box.checked) {
          removePageRow(pagesList, key);
          refreshCredits();
          return;
        }

        // The same gate "Add page" runs, for the same reason.
        box.disabled = true;
        try {
          const q = await fetchQuote({ extraPages: 1 });
          credits.total = q.totalCost;
          credits.available = q.available;
          credits.loaded = true;

          if (!q.affordable) {
            box.checked = false;
            showCreditsModal(q);
            return;
          }
        } catch (_) {
          // A blip must not block the customer; the server checks again
          // before any work is done.
        } finally {
          box.disabled = false;
        }

        addOrFillPageRow(pagesList, name, key);
      });
    });
  }

  function mountSuggestPanel(wrap, pagesList) {
    const button = el('button',
      { type: 'button', class: 'btn btn-primary btn-sm' },
      'Suggest services for me');

    const intro = el('div', { class: 'form-text mb-2' },
      'Not sure what to list? We can suggest the services this kind of business '
      + 'is usually hired for, most common first.');

    const panel = el('div', { class: 'mt-3' });
    const note = el('div', { class: 'form-text mt-2' });

    wrap.append(intro, button, panel, note);

    // A different business now. Plumbing services are wrong for an HVAC
    // company, so the old list goes and the two presses come back.
    if (state.suggestionsFor && state.suggestionsFor !== state.businessType) {
      dropSuggestedRows(pagesList, state.suggestionBatches);
      state.suggestionBatches = [];
      state.suggestionsFor = '';
    }

    function syncButton() {
      const used = (state.suggestionBatches || []).length;

      if (used >= MAX_SUGGESTION_BATCHES) {
        button.disabled = true;
        button.textContent = 'No more suggestions';
        note.textContent =
          'That is everything we would suggest for this kind of business. '
          + 'Add any others with "+ Add page" below.';
        return;
      }

      button.disabled = false;
      button.textContent = used ? 'Suggest a few more' : 'Suggest services for me';
      note.textContent = '';
    }

    // Suggestions survive stepping back and forth, because this step is
    // rebuilt from scratch each time it is shown and re-asking would mean
    // another model call for a list the customer has already seen.
    (state.suggestionBatches || []).forEach((batch, i) =>
      renderBatch(panel, pagesList, batch, i, false));

    syncButton();

    button.addEventListener('click', async () => {
      if (!state.businessType) {
        note.textContent = 'Choose a business type first and we can suggest services.';
        return;
      }
      if ((state.suggestionBatches || []).length >= MAX_SUGGESTION_BATCHES) return;

      button.disabled = true;
      button.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2"></span>Thinking…';
      note.textContent = '';

      try {
        const data = await fetchSuggestions();

        state.suggestionBatches = (state.suggestionBatches || []).concat([data]);
        state.suggestionsFor = state.businessType;

        renderBatch(panel, pagesList, data, state.suggestionBatches.length - 1, true);
      } catch (err) {
        note.textContent = err.message;
      } finally {
        syncButton();
      }
    });
  }

  // -----------------------------
  // Stepper driver
  // -----------------------------

  // -----------------------------
  // Step 6: Review before generating
  // -----------------------------
  // Generation costs credits and takes a minute, so this is the last chance
  // to catch a typo. Every group links back to the step that owns it.
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

  function reviewRow(label, value, opts = {}) {
    const shown = (value === undefined || value === null || String(value).trim() === '')
      ? '<span class="text-warning">— not set —</span>'
      : escapeHtml(String(value));

    // A card's Edit button goes to one step, but a card can hold fields from
    // several. Business Type is chosen on step 1 while the rest of the
    // Business card comes from step 3, so that row carries its own link.
    // Kept for rows whose owning step differs from their card's.
    const editLink = (opts.editStep === undefined)
      ? ''
      : ` <button type="button" class="btn btn-link btn-sm p-0 ms-2 align-baseline js-review-edit text-white"
                 data-step="${opts.editStep}">change</button>`;

    return `
      <div class="d-flex justify-content-between gap-3 py-1"
           style="border-bottom:1px solid rgba(255,255,255,.35);">
        <span class="flex-shrink-0" style="color:rgba(255,255,255,.85);">${escapeHtml(label)}</span>
        <span class="text-white text-end${opts.strong ? ' fw-bold' : ''}"
              style="min-width:0;overflow-wrap:anywhere;word-break:break-word;">${shown}${editLink}</span>
      </div>`;
  }

  // Card colours. Kept as constants so they can be changed in one place
  // rather than hunting through the markup.
  // #17801a rather than a brighter green: white body text on it clears
  // WCAG AA (5.07:1), where #1a8a1a came in just under at 4.47:1.
  const CARD_BG = '#378239';       // green card background
  const CARD_BORDER = '#2a6b2c';   // slightly darker edge
  const EDIT_BG = '#082d5b';       // Edit button, matching the site header

  function reviewCard(title, bodyHtml, editStep) {
    return `
      <div class="col-12">
        <div class="rounded p-3 h-100 text-white"
             style="background:${CARD_BG};border:2px solid ${CARD_BORDER};">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="m-0">${escapeHtml(title)}</h5>
            <button type="button" class="btn btn-sm js-review-edit text-white"
                    data-step="${editStep}"
                    style="background:${EDIT_BG};border:1px solid rgba(255,255,255,.35);">Edit</button>
          </div>
          ${bodyHtml}
        </div>
      </div>`;
  }

  // The owner row reads differently in three cases: not included, included
  // with a name, included and left to the AI.
  function ownerSummary() {
    const snap = state.mainFormSnapshot || {};
    const include = snap['global[includeOwner]'];
    const on = include === true || include === 'true' || include === 'on' || include === '1';

    if (!on) return 'Not included';

    const name = snapshotValue('ownerName');
    return name || 'We\'ll create one';
  }

  function hoursSummary() {
    const is24 = String(snapshotValue('is24Hours')).toLowerCase();
    if (is24 === 'true' || is24 === 'on' || is24 === '1') {
      return reviewRow('Hours', 'Open 24 hours');
    }

    const snap = state.mainFormSnapshot || {};
    const rows = DAYS.map(day => {
      const closed = snap[`global[hours][${day}][closed]`];
      const isClosed = closed === true || closed === 'true' || closed === 'on' || closed === '1';
      if (isClosed) return reviewRow(day[0].toUpperCase() + day.slice(1), 'Closed');
      const open  = snap[`global[hours][${day}][open]`]  || '';
      const close = snap[`global[hours][${day}][close]`] || '';
      return reviewRow(day[0].toUpperCase() + day.slice(1), open && close ? `${open} – ${close}` : '');
    });
    return rows.join('');
  }

  function socialSummary() {
    const socials = [
      ['Facebook','facebookUrl'], ['Instagram','instagramUrl'], ['Twitter/X','twitterUrl'],
      ['LinkedIn','linkedinUrl'], ['YouTube','youtubeUrl'], ['Pinterest','pinterestUrl'],
    ];
    const set = socials.filter(([, key]) => snapshotValue(key));
    if (!set.length) {
      return '<p class="text-white-50 m-0">No social links added.</p>';
    }
    return set.map(([label, key]) => reviewRow(label, snapshotValue(key))).join('');
  }

  function listSummary(items, emptyText) {
    if (!items.length) return `<p class="text-white-50 m-0">${escapeHtml(emptyText)}</p>`;
    return '<ol class="mb-0 ps-3 text-white">' +
      items.map(i => `<li>${escapeHtml(i)}</li>`).join('') +
      '</ol>';
  }

  function renderReviewStep() {
    container.innerHTML = '';

    const pages = state.pages || [];
    const locations = state.addLocations ? (state.locations || []) : [];

    const header = el('div', { class: 'mb-3' });
    header.innerHTML = `
      <h3 class="mb-2">${stepNumber(STEP.REVIEW)}. Review &amp; Generate</h3>
      <p class="text-white-50 mb-1">
        Check everything below before generating.
      </p>
      <p class="text-white-50 mb-0" id="reviewCredits">
        This will use <strong>${creditsLabel()}</strong> credits.
      </p>
    `;
    container.appendChild(header);

    const grid = el('div', { class: 'row g-3' });

    // Cards follow the wizard's own order, so reviewing walks back through
    // the same sequence the user just completed:
    //   0 business type -> 1 logo -> 2 design -> 3 details -> 4 pages
    grid.innerHTML = [
      reviewCard('What we are building', [
        reviewRow('Type',
          // From SITE_MODES, so renaming an option updates the review too.
          (SITE_MODES.find(m => m.value === state.siteMode) || {}).title || state.siteMode,
          { strong: true, editStep: STEP.MODE }),
      ].join(''), STEP.MODE),

      reviewCard('Business Type', [
        reviewRow('Category', state.businessType, { strong: true }),
      ].join(''), STEP.TYPE),

      reviewCard('Logo', [
        reviewRow('Shape', logoShapeLabel(state.logoType)),
        reviewRow('File', state.logoFile ? (state.logoFile.name || 'selected') : ''),
      ].join('') + (state.logoPreviewURL
        ? `<img src="${state.logoPreviewURL}" alt="Logo preview" class="mt-3"
               style="max-height:80px;max-width:200px;background:#fff;padding:6px;border-radius:6px;">`
        : ''), STEP.LOGO),

      reviewCard('Design', [
        reviewRow('Selected', themeLabel(state.styleKey), { strong: true }),
      ].join(''), STEP.DESIGN),

      reviewCard('Business Details', [
        reviewRow('Name', snapshotValue('businessName'), { strong: true }),
        reviewRow('Domain', snapshotValue('domain')),
        reviewRow('Location', snapshotValue('location')),
        reviewRow('Address', snapshotValue('address')),
        ...(state.siteMode === 'sample' ? [] : [reviewRow('Owner name', ownerSummary())]),
      ].join(''), STEP.MAIN),

      reviewCard('Contact', [
        reviewRow('Phone', snapshotValue('phone')),
        reviewRow('Email', snapshotValue('email')),
        reviewRow('Map CID', snapshotValue('googleMapCid')),
        reviewRow('Intro video', snapshotValue('youtubeVideoUrl')),
      ].join(''), STEP.MAIN),

      reviewCard('Hours', hoursSummary(), STEP.MAIN),

      reviewCard('Social links', socialSummary(), STEP.MAIN),

      // Pages last: they are what the credit cost is based on, so they sit
      // closest to the Generate button.
      reviewCard(`Service pages (${pages.length})`,
        listSummary(pages, 'No service pages added.'), STEP.PAGES),

      reviewCard(`Location pages (${locations.length})`,
        listSummary(locations, state.addLocations ? 'No locations added.' : 'Location pages are turned off.'), STEP.PAGES),
    ].join('');
    container.appendChild(grid);

    // Edit buttons jump back to the owning step
    grid.querySelectorAll('.js-review-edit').forEach(btn => {
      btn.addEventListener('click', () => go(Number(btn.dataset.step)));
    });

    const generateLabel = (n) =>
      `Generate ${state.siteMode === 'sample' ? 'Sample' : 'Website'} (${n} credits)`;

    renderNav(container, {
      showBack: true,
      backText: 'Back',
      nextText: generateLabel(creditsLabel()),
      onBack: () => go(STEP.PAGES),
      onNext: () => {
        // Hidden fields were injected on the previous step, so this only
        // needs to fire the submit that spinner.js listens for.
        // Submitted, so there is nothing to come back to. Left behind, it
        // would reappear on the next visit as a half-finished form nobody
        // asked for.
        clearDraft();

        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
    });

    // The total is fetched rather than computed, so it arrives a moment after
    // the step renders. Both places that show it are updated together — the
    // paragraph and the button — because a button reading one number while
    // the text above reads another is the confusion this whole change exists
    // to remove.
    refreshCredits().then((q) => {
      if (!q) return;   // a blip: leave the placeholder rather than guess

      const line = document.getElementById('reviewCredits');
      if (line) {
        line.innerHTML = `This will use <strong>${q.totalCost.toLocaleString()}</strong> credits.`;
        if (!q.affordable) {
          line.innerHTML +=
            ` <span class="text-warning">You have ${q.available.toLocaleString()}.</span>`;
        }
      }

      const btn = container.querySelector('#nextBtn');
      if (btn) btn.textContent = generateLabel(q.totalCost.toLocaleString());
    });
  }

  const steps = [
    renderSiteModeStep,          // 0  lead generation or design sample
    renderBusinessTypeStep,      // 1
    renderLogoStep,              // 2
    renderDesignStep,            // 3
    renderMainForm,              // 4
    renderPagesAndLocationsStep, // 5
    renderReviewStep             // 6
  ];
  let current = 0;
  function go(index) {
    if (index < 0 || index >= steps.length) return;
    current = index;
    steps[current]();
  }


  // Start Over (cleaner)
  // Reset everything and go back to the first step
  function startOver() {
  // 1) Remove any hidden mirrors that could leak stale values on submit
  //    (you create .js-hidden-mirror and .js-hidden-mainform before submitting)
  try {
    form?.querySelectorAll('.js-hidden-mirror, .js-hidden-mainform').forEach(n => n.remove());
  } catch {}

  // 2) Clear validation UI + inline alerts + top alert
  try {
    document.getElementById('formAlert')?.classList.add('d-none');
    container?.querySelectorAll('.is-invalid').forEach(n => n.classList.remove('is-invalid'));
    container?.querySelectorAll('.js-inline-alert')?.forEach(n => n.remove());
  } catch {}

  // 3) Reset the <form> fields that might currently exist in the DOM
  //    (this also clears text inputs like pages/locations if they’re visible)
  try { form?.reset(); } catch {}

  // 4) Reset logo state & UI (both visible inputs and the hidden file sent to backend)
  try {
    if (state.logoPreviewURL) {
      try { URL.revokeObjectURL(state.logoPreviewURL); } catch {}
    }
    state.logoPreviewURL = '';
    state.logoFile = null;
    state.logoType = 'square';

    // Clear visible file inputs if they’re present in the current step
    const square = container?.querySelector('#logoSquare');
    const rect   = container?.querySelector('#logoRect');
    const wide   = container?.querySelector('#logoWide');
    if (square) square.value = '';
    if (rect)   rect.value   = '';
    if (wide)   wide.value   = '';

    // Hide/reset the preview UI if it exists
    const previewWrap = container?.querySelector('#logoPreview');
    const previewImg  = container?.querySelector('#logoImgPreview');
    const previewName = container?.querySelector('#logoFileName');
    if (previewWrap) previewWrap.style.display = 'none';
    if (previewImg)  previewImg.src = '';
    if (previewName) previewName.textContent = '';
    
    // Clear the hidden file input used at submit time
    if (hiddenLogoInput) hiddenLogoInput.value = '';
  } catch {}

  // 5) Reset wizard “brain” (your in-memory state)
  state.siteMode          = 'rankfast';
  state.businessType      = '';
  state.mainFormSnapshot  = null;  // wipes hours, near-me, CID, etc.
  state.pages             = [];
  state.locations         = [];
  state.addLocations      = true;
  state.styleKey = 'style';
  // A new site is a new business; last one's services must not carry over.
  state.suggestionBatches = [];
  state.suggestionsFor    = '';


  // 6) Jump back to the first step (Business Type)
  go(STEP.MODE);
}


  // -----------------------------
  // Bootstrap
  // -----------------------------
  document.addEventListener('DOMContentLoaded', () => {
    container = document.getElementById('dynamicFormContainer');
    form = document.getElementById('websiteForm');
    if (!container || !form) return;

    // A draft left behind by a trip to /buy-credits. Applied before the first
    // step renders, so the wizard comes up populated rather than flashing
    // empty and then filling in.
    const draft = loadDraft();
    if (draft) {
      applyDraft(draft);
      clearDraft();
      showDraftNotice();
    }

    // single hidden logo input (backend expects this exact name)
    hiddenLogoInput = document.createElement('input');
    hiddenLogoInput.type = 'file';
    hiddenLogoInput.id = 'hiddenLogo';
    hiddenLogoInput.name = 'global[logo]';
    hiddenLogoInput.style.display = 'none';
    form.appendChild(hiddenLogoInput);

    // Defensive guard if someone submits outside the final step
    form.addEventListener('submit', (e) => {
      // Guard: must have a logo
      if (!state.logoFile) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.LOGO);
        const activeEl = state.logoType === 'square' ? container.querySelector('#logoSquare')
                       : state.logoType === 'wide'   ? container.querySelector('#logoWide')
                       : container.querySelector('#logoRect');
        activeEl?.classList.add('is-invalid');
        activeEl?.focus();
        showAlert(container, 'Please choose a logo to continue.');
        return;
      }
    
      // ---- DOM-FIRST VALUES (avoid stale state) ----
      //
      // On the review step the pages/locations inputs are no longer rendered —
      // container was cleared — so only the injected hidden mirrors remain.
      // Reading just the visible inputs made this guard think there were zero
      // service pages and refuse to submit.
      const readValues = (visibleSelector, hiddenSelector, fallback) => {
        const visible = [...form.querySelectorAll(visibleSelector)]
          .map(i => i.value.trim()).filter(Boolean);
        if (visible.length) return visible;

        const hidden = [...form.querySelectorAll(hiddenSelector)]
          .map(i => i.value.trim()).filter(Boolean);
        if (hidden.length) return hidden;

        return (fallback || []).map(v => String(v).trim()).filter(Boolean);
      };

      const pageInputsDom = form.querySelectorAll(
        '#pagesList input[name^="pages"][name$="[filename]"]:not([type="hidden"])'
      );
      const pagesVals = readValues(
        '#pagesList input[name^="pages"][name$="[filename]"]:not([type="hidden"])',
        'input[type="hidden"][name^="pages"][name$="[filename]"]',
        state.pages
      );

      const hasLocToggle = !!form.querySelector('#addLocations');
      const addLoc = hasLocToggle ? form.querySelector('#addLocations').checked : !!state.addLocations;

      const locInputsDom = form.querySelectorAll(
        '#locationsList input[name="global[locationPages][]"]:not([type="hidden"])'
      );
      const locVals = addLoc
        ? readValues(
            '#locationsList input[name="global[locationPages][]"]:not([type="hidden"])',
            'input[type="hidden"][name="global[locationPages][]"]',
            state.locations
          )
        : [];
    
      // Guard: must have ≥1 service page
      if (pagesVals.length === 0) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.PAGES);
        // highlight first page input if it's on screen
        pageInputsDom[0]?.classList.add('is-invalid');
        pageInputsDom[0]?.focus();
        showAlert(container, 'Please add at least one service page.');
        return;
      }

      // Guard: no duplicate service pages or locations. Two entries that
      // slugify the same would write to one file and overwrite each other.
      const submitPageDupes = findDuplicates([...pageInputsDom]);
      if (submitPageDupes.dupes.length) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.PAGES);
        [...pageInputsDom].forEach(i => i.classList.remove('is-invalid'));
        submitPageDupes.dupes.forEach(i => i.classList.add('is-invalid'));
        submitPageDupes.dupes[0]?.focus();
        showAlert(container, `Duplicate service page: ${submitPageDupes.labels.join(', ')}. Each page needs a different name.`);
        return;
      }

      // Guard: services that are not the same page but read as the same
      // service. Asked once — a second refusal on a decision already made
      // would be the form arguing with someone who has understood it.
      if (!state.confirmedSimilarServices) {
        const similar = findSimilarPairs(pagesVals);

        if (similar.length) {
          e.preventDefault();
          e.stopImmediatePropagation(); // stop spinner.js submitting anyway

          const first = similar[0];
          const more = similar.length > 1
            ? `\n\n(and ${similar.length - 1} other similar ${similar.length - 1 === 1 ? 'pair' : 'pairs'})`
            : '';

          const proceed = window.confirm(
            `"${first[0]}" and "${first[1]}" look like the same service.${more}\n\n`
            + `Two pages about one thing compete with each other in search, so usually only `
            + `one of them ranks — and you would be paying for both.\n\n`
            + `Generate anyway?`
          );

          if (!proceed) {
            go(STEP.PAGES);
            return;
          }

          // Remembered, so the resubmit below is not stopped by this guard
          // again. Reset by the same code that resets the rest of the wizard.
          state.confirmedSimilarServices = true;
          form.requestSubmit ? form.requestSubmit() : form.submit();
          return;
        }
      }

      if (addLoc) {
        const submitLocDupes = findDuplicates([...locInputsDom]);
        if (submitLocDupes.dupes.length) {
          e.preventDefault();
          e.stopImmediatePropagation(); // stop spinner.js submitting anyway
          go(STEP.PAGES);
          [...locInputsDom].forEach(i => i.classList.remove('is-invalid'));
          submitLocDupes.dupes.forEach(i => i.classList.add('is-invalid'));
          submitLocDupes.dupes[0]?.focus();
          showAlert(container, `Duplicate location: ${submitLocDupes.labels.join(', ')}. Each location needs a different city.`);
          return;
        }
      }
    
      // Guard: if locations are ON, must have ≥1 location
      if (addLoc && locVals.length === 0) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.PAGES);
        // highlight first location input if it's on screen
        locInputsDom[0]?.classList.add('is-invalid');
        locInputsDom[0]?.focus();
        showAlert(container, 'Please add at least one location, or turn off “Add location pages”.');
        return;
      }
    
      // Keep state in sync (useful if submit came from Enter key)
      state.pages = pagesVals;
      state.addLocations = addLoc;
      state.locations = locVals;
    
      // Mirror logo into the hidden input the backend expects
      const dt = new DataTransfer();
      dt.items.add(state.logoFile);
      hiddenLogoInput.files = dt.files;
    
      // Ensure we have the latest snapshot of the Main Form (includes hours)
      if (!state.mainFormSnapshot) {
        state.mainFormSnapshot = snapshotFormValues(form);
      }
    
      // Clean previous mirrors
      form.querySelectorAll('.js-hidden-mirror, .js-hidden-mainform').forEach(n => n.remove());


      // === Inject logoType hidden field (safety for Enter/other submits) ===
       
      // Same treatment as styleKey: one authoritative value, no stale mirrors
      form.querySelectorAll('input[name="global[logoType]"]').forEach(n => n.remove());
      const logoTypeHidden = document.createElement('input');
      logoTypeHidden.type = 'hidden';
      logoTypeHidden.name = 'global[logoType]';
      logoTypeHidden.classList.add('js-hidden-mirror', 'js-hidden-logo-shape');
      logoTypeHidden.value = state.logoType; // "square" | "rect" | "wide"
      form.appendChild(logoTypeHidden);



      // === Inject styleKey hidden field (ensures backend gets the chosen theme) ===
      form.querySelectorAll('input[name="global[siteMode]"]').forEach(n => n.remove());
      const siteModeHidden = document.createElement('input');
      siteModeHidden.type = 'hidden';
      siteModeHidden.name = 'global[siteMode]';
      siteModeHidden.classList.add('js-hidden-mirror');
      siteModeHidden.value = state.siteMode;
      form.appendChild(siteModeHidden);

      // Business type is chosen on step 1 but rendered as a hidden input
      // inside the main form, so the step-3 snapshot captures it. Going back
      // to change it left the snapshot holding the OLD value, which then
      // re-injected itself at submit — the review card showed the new type
      // while the generated site used the old one.
      form.querySelectorAll('input[name="global[businessType]"]').forEach(n => n.remove());
      const businessTypeHidden = document.createElement('input');
      businessTypeHidden.type = 'hidden';
      businessTypeHidden.name = 'global[businessType]';
      businessTypeHidden.classList.add('js-hidden-mirror');
      businessTypeHidden.value = state.businessType;
      form.appendChild(businessTypeHidden);

      // Remove every existing styleKey input (design-step radios or a stale
      // mirror) so exactly one value is submitted.
      form.querySelectorAll('input[name="global[styleKey]"]').forEach(n => n.remove());
      const styleKeyHidden = document.createElement('input');
      styleKeyHidden.type = 'hidden';
      styleKeyHidden.name = 'global[styleKey]';
      styleKeyHidden.classList.add('js-hidden-mirror');
      styleKeyHidden.value = state.styleKey;
      form.appendChild(styleKeyHidden);




    
      // ⬇️ Only inject HIDDEN PAGES if the visible page inputs are NOT present
      const hasPageInputsInDom = !!form.querySelector('#pagesList input[name^="pages"][name$="[filename]"]');
      if (!hasPageInputsInDom) {
        const hiddenPagesWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
        state.pages.forEach((p, idx) => {
          hiddenPagesWrap.appendChild(el('input', { type:'hidden', name:`pages[${idx}][filename]`, value:p }));
        });
        form.appendChild(hiddenPagesWrap);
      }
    
      // ⬇️ Only inject HIDDEN LOCATIONS if the visible location inputs are NOT present
      const hasLocationInputsInDom = !!form.querySelector('#locationsList input[name="global[locationPages][]"]');
      if (!hasLocationInputsInDom) {
        const hiddenLocWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
        hiddenLocWrap.appendChild(el('input', {
          type:'hidden', name:'global[addLocations]', value: state.addLocations ? 'true' : ''
        }));
        if (state.addLocations) {
          state.locations.forEach(loc => {
            hiddenLocWrap.appendChild(el('input', { type:'hidden', name:'global[locationPages][]', value: loc }));
          });
        }
        form.appendChild(hiddenLocWrap);
      }
    
      // Inject hidden inputs for the ENTIRE main form (includes hours!)
      // If 24h is ON, drop per-day hour keys.
      const is24 =
        state.mainFormSnapshot?.['global[is24Hours]'] === true ||
        state.mainFormSnapshot?.['global[is24Hours]'] === 'true';
    
      injectHiddenSnapshot(
        form,
        state.mainFormSnapshot,
        'js-hidden-mainform',
        (name) => {
          if (STATE_OWNED_FIELDS.includes(name)) return false;
          if (is24 && name.startsWith('global[hours][')) return false;
          return true;
        }
      );
    });   
    go(STEP.MODE);
  });
})();