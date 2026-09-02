// blog-engine-preview/run.js
//
// Throwaway harness. Plans a campaign, writes every post, then SIMULATES the
// publishing schedule so you can watch the pending links switch on.
//
//   node blog-engine-preview/run.js --stub     # no model calls
//   node blog-engine-preview/run.js            # uses utils/openaiClient
//
// Output lands in blog-engine-preview/out/:
//   post-1-<slug>.html ... the post as it looked ON ITS PUBLISH DAY
//   final-1-<slug>.html ... the same post after every later post went live
//   report.txt          ... the link graph, the anchor mix, and what changed
//
// Read the "final" files as if you were the business owner. That is the only
// question this script exists to answer.

const fs = require('fs');
const path = require('path');

const { planCampaign, findOrphans, queryConflicts, slugify } = require('./planCampaign');
const { applyLinks, activate, pendingIds } = require('./links');
const { writePost } = require('./writePost');
const { suggestTopics } = require('./suggestTopics');
const { enrichTopics } = require('./enrichTopic');
const { checkPost, crossCheck, formatReport, checkTopicSet } = require('./qualityCheck');
const campaign = require('./campaign.example');

const OUT = path.join(__dirname, 'out');

// --suggest              propose topics and stop; nothing is written
// --mine="a; b; c"       enrich topics YOU typed, and stop. Combine with
//                        --suggest to see both paths cooperate: your topics
//                        first, then suggestions told to avoid them.
// --stub                 no model calls at all
// --model=gpt-...        try a different model
// --effort=none|low|...  reasoning effort; billed as output tokens
// --verbosity=low|medium|high
function flag(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const opts = {
  stub:      process.argv.includes('--stub'),
  model:     flag('model'),
  effort:    flag('effort'),
  verbosity: flag('verbosity'),
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turn the writer's JSON into post HTML, tokens still intact. */
function toHtml(post) {
  return post.sections.map(sec => {
    const h = sec.heading ? `<h2>${esc(sec.heading)}</h2>\n` : '';
    const p = (sec.paragraphs || []).map(t => `<p>${t}</p>`).join('\n');
    return h + p;
  }).join('\n\n');
}

function page(title, meta, body, note) {
  return `<!DOCTYPE html>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta)}">
<style>
  body { font: 17px/1.65 Georgia, serif; max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  h1 { font-size: 1.9rem; line-height: 1.2; }
  h2 { font-size: 1.25rem; margin-top: 2rem; }
  a { color: #0b5; }
  span[data-il-link] { background: #fff3cd; border-bottom: 1px dashed #b8860b; }
  .note { font: 13px/1.5 ui-monospace, monospace; background: #f4f4f5; padding: .75rem 1rem; margin-bottom: 2rem; color: #444; white-space: pre-wrap; }
</style>
<div class="note">${esc(note)}</div>
<h1>${esc(title)}</h1>
${body}
`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // --mine / --suggest: the planning screen. The owner types their own
  // topics, takes suggestions, or does both in one campaign.
  const mineFlag = process.argv.find(a => a.startsWith('--mine='));

  if (mineFlag || process.argv.includes('--suggest')) {
    let mine = [];

    if (mineFlag) {
      const raw = mineFlag.slice('--mine='.length).split(';').map(t => t.trim()).filter(Boolean);
      mine = await enrichTopics(raw, campaign, opts);

      console.log(`\nYour topics — the two fields below each are editable\n`);
      for (const t of mine) {
        console.log(`  ${t.topic}`);
        console.log(`    targets                "${t.targetQuery}"`);
        console.log(`    others refer to it as  "${t.linkPhrase}"`);
        if (t.note) console.log(`    ! ${t.note}`);
        console.log('');
      }
    }

    // Suggestions are told what the owner already typed, so the two paths
    // cooperate instead of proposing the same thing twice.
    const ideas = process.argv.includes('--suggest')
      ? await suggestTopics(campaign, {
          ...opts,
          count: 6,
          avoid: mine.map(t => `${t.topic} (targets "${t.targetQuery}")`),
        })
      : [];

    // Checked and written as ONE set — typed and suggested together. A clash
    // between one of each is exactly the kind nobody notices by eye.
    const all = [...mine, ...ideas];

    if (ideas.length) {
      console.log(`Topic ideas for ${campaign.business.name} — target: ${campaign.targetPage.title}\n`);
    }
    ideas.forEach((t, i) => {
      console.log(`${String(i + 1).padStart(2)}. ${t.topic}`);
      console.log(`    query      ${t.targetQuery}`);
      console.log(`    angle      ${t.angle}`);
      console.log(`    linkPhrase ${t.linkPhrase}`);
      console.log(`    why        ${t.why}\n`);
    });

    fs.writeFileSync(
      path.join(OUT, 'topics.json'),
      JSON.stringify(
        all.map(t => ({ topic: t.topic, targetQuery: t.targetQuery, linkPhrase: t.linkPhrase })),
        null, 2
      )
    );
    const set = checkTopicSet(all, campaign.targetPage, campaign.business);
    if (set.ok) {
      console.log('Topic set: intent aligned, queries distinct, titles varied.\n');
    } else {
      console.log('Topic set — worth a look before you commit:\n');
      for (const w of set.warnings) console.log(`  ! ${w}`);
      console.log('');
    }

    console.log(`Paste-ready topics written to ${path.join(OUT, 'topics.json')}`);
    return;
  }

  const plan = planCampaign(campaign);
  const log = [];

  log.push(`CAMPAIGN  ${campaign.business.name} — ${campaign.business.town}`);
  log.push(`TARGET    ${plan.targetPage.title}  ${plan.targetPage.url}`);
  log.push(`CADENCE   every ${plan.cadenceDays} days`);
  log.push(`ANCHORS   ${JSON.stringify(plan.anchorSummary)}`);
  log.push(`WRITER    ${opts.stub ? 'stub (no model calls)' : `${opts.model || 'gpt-5.6-terra'} effort=${opts.effort || 'low'} verbosity=${opts.verbosity || 'high'}`}`);
  log.push('');

  // Query conflicts are checked BEFORE anything is written, because the fix is
  // to change a topic — and that is free until the post exists.
  const conflicts = queryConflicts(plan);
  if (conflicts.length) {
    log.push('QUERY CONFLICTS');
    for (const c of conflicts) {
      log.push(`  ${c.kind.toUpperCase().padEnd(12)} ${c.a}${c.b ? ' + ' + c.b : ''}`);
      log.push(`               ${c.detail}`);
    }
  } else {
    log.push('QUERIES   all distinct, none competing with the service page');
  }
  log.push('');

  const orphans = findOrphans(plan);
  log.push(orphans.length ? `ORPHANS   ${orphans.join(', ')}` : 'ORPHANS   none — every post has an inbound link');
  log.push('');
  log.push('LINK PLAN');
  for (const s of plan.slots) {
    const bits = [`money(${s.money.anchorType})`];
    if (s.prev) bits.push(`prev→${s.prev.id}`);
    if (s.next) bits.push(s.next.pending ? `next→${s.next.id} PENDING` : `ring→${s.next.id} live`);
    log.push(`  ${s.id}  ${s.slug}`);
    log.push(`      ${bits.join('  ')}`);
    log.push(`      anchor: "${s.money.anchor}"${s.money.reusedAnchor ? '  [REUSED — widen the pool]' : ''}`);
    log.push(`      query:  "${s.targetQuery || '(none assigned)'}"`);
  }
  log.push('');

  // --- write every post ---------------------------------------------------

  const posts = [];
  for (const slot of plan.slots) {
    const prevSlot = slot.prev ? plan.slots[slot.prev.slotIndex] : null;
    const nextSlot = slot.next ? plan.slots[slot.next.slotIndex] : null;

    const ctxSlot = {
      ...slot,
      prevTitle:  prevSlot ? prevSlot.topic : null,
      prevAnchor: prevSlot ? anchorFor(prevSlot, log) : null,
      nextTopic:  nextSlot ? nextSlot.topic : null,
      nextAnchor: nextSlot ? anchorFor(nextSlot, log) : null,
    };

    const written = await writePost(ctxSlot, campaign, opts);
    const check = checkPost(written, ctxSlot);

    // The writer names the post, and its title is often better than the
    // working topic. Rebuild the slug from what it actually wrote, or the URL
    // says "...can-leave-hot-water-lukewarm" for a post titled "...can turn a
    // hot shower lukewarm". In production WordPress assigns the slug at
    // creation and the plugin records what it got — same principle.
    if (written.title) slot.slug = slugify(written.title);

    posts.push({ slot, ctxSlot, written, check, html: toHtml(written) });

    const mark = check.ok ? (check.warnings.length ? '~' : '✓') : '✗';
    process.stdout.write(`${mark} ${slot.id}  ${written.title}\n`);
  }

  // --- publish them in order, activating pending links as we go -----------

  const live = new Map(); // slotId -> { html, slot, written }

  for (const p of posts) {
    const { slot } = p;
    const url = `${campaign.siteUrl}/${slot.slug}/`;
    slot.url = url;

    const nextSlot = slot.next ? plan.slots[slot.next.slotIndex] : null;
    const prevSlot = slot.prev ? plan.slots[slot.prev.slotIndex] : null;

    const targets = {
      money: { url: plan.targetPage.url },
      prev:  prevSlot ? { url: prevSlot.url } : null,
      next:  nextSlot
        ? (slot.next.pending ? { pendingId: nextSlot.id } : { url: nextSlot.url })
        : null,
    };

    const { html, missing } = applyLinks(p.html, targets);
    if (missing.length) {
      log.push(`WARNING   ${slot.id} — writer omitted token(s): ${missing.join(', ')}`);
    }

    live.set(slot.id, { html, slot, written: p.written });

    // Snapshot: this is the post as it looked the day it went live.
    fs.writeFileSync(
      path.join(OUT, `post-${slot.index + 1}-${slot.slug}.html`),
      page(
        p.written.title,
        p.written.metaDescription,
        html,
        `AS PUBLISHED — ${slot.publishAt.toDateString()}\n` +
        `highlighted = pending link, waiting on: ${pendingIds(html).join(', ') || 'nothing'}`
      )
    );

    // Now switch on every pending link that was waiting for THIS post.
    for (const [id, rec] of live) {
      if (id === slot.id) continue;
      const res = activate(rec.html, slot.id, url);
      if (res.count) {
        rec.html = res.html;
        log.push(`ACTIVATE  ${slot.publishAt.toDateString()}  ${id} → ${slot.id}  (${res.count} link)`);
      }
    }
  }

  // --- final state --------------------------------------------------------

  log.push('');
  log.push('FINAL STATE');
  for (const [id, rec] of live) {
    const stillPending = pendingIds(rec.html);
    const links = (rec.html.match(/<a href=/g) || []).length;
    log.push(`  ${id}  ${links} live link(s)` + (stillPending.length ? `  STILL PENDING: ${stillPending.join(', ')}` : ''));

    fs.writeFileSync(
      path.join(OUT, `final-${rec.slot.index + 1}-${rec.slot.slug}.html`),
      page(
        rec.written.title,
        rec.written.metaDescription,
        rec.html,
        `FINAL — after the whole campaign has published\n` +
        `every link below is live`
      )
    );
  }

  // --- quality ------------------------------------------------------------
  //
  // Deliberately last, and deliberately loud. The links working is table
  // stakes; whether the writing is publishable is the actual question.
  log.push('');
  log.push('QUALITY');
  if (opts.stub) {
    log.push('  (stub mode — the placeholder prose is deliberately generic,');
    log.push('   so these failures are expected and prove the checks work)');
  }
  log.push(formatReport(
    posts.map(p => ({ id: p.slot.id, check: p.check })),
    crossCheck(posts.map(p => p.written))
  ));

  const failed = posts.filter(p => !p.check.ok).length;
  log.push('');
  log.push(failed
    ? `${failed} of ${posts.length} posts would not be worth publishing as written.`
    : `All ${posts.length} posts pass the mechanical checks — now read them.`);

  fs.writeFileSync(path.join(OUT, 'report.txt'), log.join('\n') + '\n');
  console.log('\n' + log.join('\n'));
  console.log(`\nwrote ${posts.length * 2 + 1} files to ${OUT}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});

/**
 * How another post refers to this one.
 *
 * Falls back to a truncated title, which reads badly on purpose — it makes a
 * missing linkPhrase obvious in the report rather than shipping "signs your
 * water heater is" as anchor text.
 */
function anchorFor(slot, log) {
  if (slot.linkPhrase) return slot.linkPhrase;

  log.push(`WARNING   ${slot.id} has no linkPhrase — falling back to a truncated title`);
  return String(slot.topic)
    .replace(/^(how to|what to do|why|when|should you|the)\s+/i, '')
    .replace(/\?$/, '')
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');
}