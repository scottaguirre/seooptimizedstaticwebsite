// utils/blog/linkPlan.js
//
// The bridge between a stored campaign and the shape writePost() and
// checkPost() expect.
//
// WHY IT IS COMPUTED AT GENERATION TIME, NOT AT PLANNING TIME
//
// planCampaign() decides the ring when the campaign is created: post 3 links
// forward to post 4, and that link is `pending` because post 4 does not exist.
// Weeks later, when post 3 is finally written, post 4 may or may not exist —
// slots can be generated out of order, a customer can trigger one by hand, or
// an earlier run may have got ahead.
//
// So "is this link real or a placeholder?" is answered from the campaign's
// CURRENT state, at the moment the post is written. A link that can be real
// should be real: a placeholder costs an edit later, and every placeholder
// that never gets swapped is a link that never existed.
//
// WHAT writePost() AND checkPost() NEED
//
// Both read the same slot object, and they must agree exactly — checkPost
// verifies the model emitted `{{money}}<anchor>{{/money}}` verbatim, so if the
// anchor handed to the writer differs by one character from the one handed to
// the checker, every post fails its own check.
//
//     slot.money       { anchor, url }
//     slot.prevAnchor  string | null
//     slot.prevTitle   string
//     slot.nextAnchor  string | null
//     slot.nextTopic   string
//     slot.id, slot.topic, slot.targetQuery, slot.title

/**
 * Which slot a given index links backwards and forwards to.
 *
 * The ring: every post links to its neighbours, and the last closes back to
 * the first. Single-post campaigns have neither.
 */
function ringNeighbours(slots, index) {
    const n = slots.length;
    if (n < 2) return { prev: null, next: null };

    /* A RING OF TWO IS A PAIR, AND IT HAS ONLY ONE EDGE.
     *
     * The general rule below hands post 1 a prev of slot 0 AND a next of
     * slot 0 — because it is the last post, so it closes the ring back to the
     * start, which is also the post immediately behind it. Two links, one
     * destination, both inside the same article. Edwin planned two pillars and
     * found the second one linking back to the first twice.
     *
     * THE RING IS NOT WRONG FOR n >= 3. Post 2 of three links back to post 1
     * and forward to post 0, and those are different posts. It is wrong for
     * exactly n = 2, where "the one behind me" and "the one I close the ring
     * to" are the same post. A rule that is right everywhere except at its
     * smallest case is the kind that survives review and fails in use.
     *
     * SO THE PAIR IS SPELT OUT RATHER THAN DERIVED. Post 0 links forward to
     * post 1; post 1 links back to post 0. One link each, mutual — which is
     * what two hub articles pointing at each other means.
     *
     * THE DIRECTION IS NOT ARBITRARY. `prev` is expected to be published
     * already; `next` is allowed to be a placeholder, swapped in when its
     * target publishes. Post 0 is written first, when its partner does not
     * exist, so it takes the forward link. Post 1 takes the backward one. Give
     * post 0 the backward link instead and it would point at nothing. */
    if (n === 2) {
      return index === 0
        ? { prev: null, next: slots[1] }
        : { prev: slots[0], next: null };
    }

    const prev = index > 0 ? slots[index - 1] : null;

    // The last post closes the ring to slot 0, which by then certainly exists.
    const next = index < n - 1 ? slots[index + 1] : slots[0];

    return { prev, next };
  }
  
  /**
   * A slot's URL, if it has one.
   *
   * Only a published slot has a URL, and it is the one WordPress actually
   * assigned — not one built from the requested slug. WordPress appends -2 to a
   * slug already in use, so a URL assembled from the plan would 404.
   */
  function publishedUrl(slot) {
    return slot && slot.status === 'published' && slot.publishedUrl
      ? slot.publishedUrl
      : null;
  }
  
  /**
   * How another post refers to this one in a sentence.
   *
   * linkPhrase is set at planning time precisely so post 3 can link to post 5
   * with wording that still makes sense when post 5 finally exists. Falling
   * back to the topic is acceptable but worse: topics are headline-shaped and
   * read awkwardly mid-sentence.
   */
  function referTo(slot) {
    if (!slot) return null;
    return slot.linkPhrase || slot.publishedTitle || slot.topic || null;
  }
  
  /**
   * Build everything the writer and the checker need for one slot.
   *
   * @param {object} campaign  a BlogCampaign document
   * @param {number} slotIndex
   * @returns {{ slot: object, ctx: object, pending: Array }}
   */
  function buildLinkPlan(campaign, slotIndex) {
    const slots = (campaign.slots || []).slice().sort((a, b) => a.index - b.index);
    const position = slots.findIndex(s => s.index === slotIndex);
  
    if (position === -1) {
      throw new Error(`buildLinkPlan: campaign has no slot ${slotIndex}`);
    }
  
    const self = slots[position];
    const { prev, next } = ringNeighbours(slots, position);

    /* NO MONEY PAGE, AND NOT A MISSING ONE.
     *
     * A pillar campaign writes the hub articles a later campaign will point
     * at, so it has nothing to point at itself. Its posts carry the ring and
     * nothing else.
     *
     * READ FROM THE FLAG, NOT FROM WHETHER targetPage HAPPENS TO BE EMPTY.
     * An ordinary campaign whose targetPage went missing is a bug, and
     * inferring "pillar" from the absence would silently turn it into a
     * campaign with a third of its links gone — the failure would show up
     * months later as posts that never fed anything. */
    const isPillar = !!campaign.isPillar;
    const target = campaign.targetPage || {};

    // Anchors carried on the slot, chosen once at planning time by anchors.js so
    // the campaign's whole anchor mix is balanced. Regenerating one here would
    // break that balance and, worse, could hand the writer a different phrase
    // than the checker later verifies.
    const moneyAnchor = self.moneyAnchor || target.keyword;

    const prevAnchor = referTo(prev);
    const nextAnchor = referTo(next);
  
    // A forward link is a placeholder ONLY while its target is unpublished.
    // Re-checked here rather than trusted from the plan, because slots can be
    // generated out of order.
    const nextUrl = publishedUrl(next);
    const prevUrl = publishedUrl(prev);
  
    const pending = [];
  
    const slot = {
      id: `slot-${self.index}`,
      index: self.index,
      topic: self.topic,
      title: self.publishedTitle || null,
      targetQuery: self.targetQuery || null,
      linkPhrase: self.linkPhrase || null,
    };

    /* ASSIGNED, NOT SET TO NULL, so `'money' in slot` and `slot.money` agree.
     *
     * writePost() and qualityCheck() both ask `if (slot.money)`, and the
     * writer's question is the one that used to go unasked — its push was
     * unconditional while prev and next below it were guarded. An absent key
     * is what makes that guard mean something. */
    if (!isPillar) {
      // Always live: the money page exists before the campaign does.
      slot.money = {
        anchor: moneyAnchor,
        url: target.url,
        anchorType: self.anchorType || 'semantic',
      };
    }
  
    // Backwards. Normally published already, but a slot generated out of order
    // can have an unpublished predecessor — in which case it becomes a
    // placeholder like any other unresolvable link, rather than a broken URL.
    if (prev && prevAnchor) {
      slot.prevAnchor = prevAnchor;
      slot.prevTitle = prev.publishedTitle || prev.topic || '';
  
      if (!prevUrl) {
        pending.push({ token: 'prev', slotIndex: prev.index, id: `slot-${prev.index}` });
      }
    }
  
    // Forwards. Usually a placeholder; already live when the ring closes back to
    // slot 0, or when a later slot was generated first.
    if (next && nextAnchor && next.index !== self.index) {
      slot.nextAnchor = nextAnchor;
      slot.nextTopic = next.topic || '';
  
      if (!nextUrl) {
        pending.push({ token: 'next', slotIndex: next.index, id: `slot-${next.index}` });
      }
    }
  
    // What links.js applyLinks() needs: a real URL, or a pendingId that becomes
    // a <span data-il-link="..."> for the plugin to swap later.
    const targets = {};

    // Same condition as slot.money above, and it has to be: applyLinks() pairs
    // the two, so a target with no anchor is a URL nothing points at and an
    // anchor with no target is a token left in the published text.
    if (!isPillar) {
      targets.money = { url: target.url };
    }

    if (slot.prevAnchor) {
      targets.prev = prevUrl ? { url: prevUrl } : { pendingId: `slot-${prev.index}` };
    }
  
    if (slot.nextAnchor) {
      targets.next = nextUrl ? { url: nextUrl } : { pendingId: `slot-${next.index}` };
    }
  
    const ctx = {
      /* WHICH BRIEF THE WRITER USES, and it is a separate question from
       * whether there is a money page.
       *
       * writePost picks between two system prompts on this: the trade one
       * ("you are a working tradesperson writing for your own customers") and
       * a blog one. Inferring it from targetPage below being null would work
       * today and is the wrong hook — "there is no page to sell" and "there is
       * no business behind this" are different claims that happen to coincide,
       * and the day they stop, every post gets the wrong voice with nothing to
       * say so.
       *
       * Both fields are derived HERE, from one `isPillar`, within a few lines
       * of each other, so there is no second coercion to drift. */
      isPillar,

      business: {
        name: campaign.site?.business?.name || '',
        trade: campaign.site?.business?.type || '',
        town: String(campaign.site?.business?.location || '').replace(/,\s*[A-Z]{2}$/, ''),
        // writePost joins this, so it must be an array even when empty.
        services: [target.keyword].filter(Boolean),
      },

      /* NULL ON A PILLAR CAMPAIGN, rather than an object of empty strings.
       *
       * buildPrompt() reads targetPage.title into the sentence "It becomes a
       * link to the X page" — but only inside the money block, which a pillar
       * campaign does not reach. Handing it `{ url: '', keyword: '', title: ''
       * }` would make that read succeed and produce "the page", and would
       * make every `if (ctx.targetPage)` downstream a test that always
       * passes. AN EMPTY VALUE IS A CLAIM THAT THE VALUE EXISTS. */
      targetPage: isPillar ? null : {
        url: target.url,
        keyword: target.keyword,
        // writePost's prompt says "It becomes a link to the ${targetPage.title}
        // page", so an absent title would read as "the undefined page".
        title: target.title || target.keyword,
        intent: target.intent || '',
      },
    };
  
    return { slot, ctx, targets, pending };
  }
  
  module.exports = { buildLinkPlan, ringNeighbours, referTo, publishedUrl };