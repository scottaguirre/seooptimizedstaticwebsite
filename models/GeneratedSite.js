// models/GeneratedSite.js
//
// Who owns which published site.
//
// WHY THIS IS A ROW AND NOT A FOLDER — Edwin, 29 October, on editing a live
// site: "every owner of the site and only the owner of the site will be able
// to edit the site nobody else."
//
// Nothing in the app could answer that. A build wrote to dist/user_<id>,
// which holds ONE site and is wiped by the next build, and then published to
// a repository on a client's GitHub. The site existed in two places and was
// owned by neither: the folder forgets it on the next build, and the
// repository knows a GitHub account, not a login.
//
//     THE CONTENT IS NOT WHAT IS MISSING. THE POINTER IS.
//
// Every published site carries its own words in _src/localoptions.json, in
// its own repository, and renders from them for nothing. So this row is
// deliberately thin: it says who, where, and what it is called. The words
// stay where they are.
//
// AND IT IS WHAT ENDS "ONE SITE PER ACCOUNT". dist/user_<id> being wiped by
// the next build stopped mattering the day the site started living in its
// own repository; this is the list that was missing to go with it.

const mongoose = require('mongoose');

const generatedSiteSchema = new mongoose.Schema({
  /**
   * The login that built it, and the only one that may edit it.
   *
   * THE WHOLE POINT OF THE ROW. Every screen that loads a site loads it
   * scoped to this, so a guessed id answers "not here" rather than somebody
   * else's site — the same rule ownedBlog() follows on the blog side.
   */
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  /**
   * The domain row it was published to.
   *
   * KEPT AS A REFERENCE RATHER THAN A STRING, because the row carries the
   * GitHub installation — and an editor that re-publishes needs that, not
   * the domain's spelling. The spelling is below for showing on a screen
   * without a second query.
   */
  domain: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Domain',
    index: true,
  },

  /** "acme.com", for a list that has to read as addresses. */
  domainName: { type: String, default: '', trim: true },

  /**
   * The repository, which is also the path the site is served at.
   *
   * THE SITE'S IDENTITY, decided by repoNameFor() from the business name and
   * used by the publisher, by the canonical on every page and by this row.
   * One string, produced once — see the note in utils/github/publishSite.js
   * about what two copies of a slug rule would cost.
   */
  repo: { type: String, required: true, trim: true, index: true },

  /** The GitHub account it sits on, for building a link without a lookup. */
  owner: { type: String, default: '', trim: true },

  /** What the customer called the business. */
  businessName: { type: String, default: '', trim: true },

  /** Which trade, so a list can be read at a glance. */
  trade: { type: String, default: '', trim: true },

  /**
   * When it was last pushed, and the commit that went up.
   *
   * NOT A "published: true" FLAG. A date answers "is this live, and how
   * stale is it" — a boolean answers only the first, and the second is the
   * question somebody actually has when they are looking at a list.
   */
  publishedAt: { type: Date },
  commitSha: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },

}, { timestamps: true });

/**
 * One row per site, enforced by the database.
 *
 * A SITE IS A REPOSITORY ON AN ACCOUNT, so that pair is what has to be
 * unique. Building the same business twice updates one site — the publisher
 * pushes to the same repository — and this makes the row follow it rather
 * than accumulating a second one that nothing would ever show.
 *
 * NOT user+repo: two customers could each have a plumbing site called the
 * same thing on different accounts, and that is two sites, correctly.
 */
generatedSiteSchema.index({ owner: 1, repo: 1 }, { unique: true });

module.exports = mongoose.models.GeneratedSite
  || mongoose.model('GeneratedSite', generatedSiteSchema);
