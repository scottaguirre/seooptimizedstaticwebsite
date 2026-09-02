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
  
    // Anchors carried on the slot, chosen once at planning time by anchors.js so
    // the campaign's whole anchor mix is balanced. Regenerating one here would
    // break that balance and, worse, could hand the writer a different phrase
    // than the checker later verifies.
    const moneyAnchor = self.moneyAnchor || campaign.targetPage.keyword;
  
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
  
      // Always live: the money page exists before the campaign does.
      money: {
        anchor: moneyAnchor,
        url: campaign.targetPage.url,
        anchorType: self.anchorType || 'semantic',
      },
    };
  
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
    const targets = {
      money: { url: campaign.targetPage.url },
    };
  
    if (slot.prevAnchor) {
      targets.prev = prevUrl ? { url: prevUrl } : { pendingId: `slot-${prev.index}` };
    }
  
    if (slot.nextAnchor) {
      targets.next = nextUrl ? { url: nextUrl } : { pendingId: `slot-${next.index}` };
    }
  
    const ctx = {
      business: {
        name: campaign.site?.business?.name || '',
        trade: campaign.site?.business?.type || '',
        town: String(campaign.site?.business?.location || '').replace(/,\s*[A-Z]{2}$/, ''),
        // writePost joins this, so it must be an array even when empty.
        services: [campaign.targetPage.keyword].filter(Boolean),
      },
      targetPage: {
        url: campaign.targetPage.url,
        keyword: campaign.targetPage.keyword,
        // writePost's prompt says "It becomes a link to the ${targetPage.title}
        // page", so an absent title would read as "the undefined page".
        title: campaign.targetPage.title || campaign.targetPage.keyword,
        intent: campaign.targetPage.intent || '',
      },
    };
  
    return { slot, ctx, targets, pending };
  }
  
  module.exports = { buildLinkPlan, ringNeighbours, referTo, publishedUrl };