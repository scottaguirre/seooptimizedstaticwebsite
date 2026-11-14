// models/Domain.js
//
// A domain customers may put a blog on, and the Cloudflare account it lives
// on.
//
// WHAT THIS IS FOR
//
// Instead of a customer typing a whole domain and then being told to paste a
// CNAME at their registrar, they pick one of these from a list and type a
// prefix. `hvac` + `acmehvac.com` becomes hvac.acmehvac.com, and because the
// zone is already on the Cloudflare account the Pages project is created in,
// CLOUDFLARE WRITES THE DNS RECORD ITSELF. The customer does nothing.
//
// THE ACCOUNT IS A PROPERTY OF THE DOMAIN, AND THAT IS THE WHOLE DESIGN
//
// Not round-robin, not whichever account has room. Cloudflare only writes
// that DNS record when the Pages project and the zone are on the SAME
// account. Put the project somewhere else and the automatic DNS stops,
// silently, and the blog answers on nothing until somebody pastes a CNAME.
//
// SUBDOMAINS ONLY, AND IT IS A CONSTRAINT RATHER THAN A PREFERENCE
//
// Cloudflare Pages will attach a subdomain whose zone is anywhere — the owner
// adds a CNAME at their own provider. An APEX domain must be a zone on the
// same account with its nameservers pointed at Cloudflare. Offering apex
// means taking over a client's nameservers, which is a different product.

const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  /**
   * The registrable domain, lowercase, with no scheme and no trailing dot.
   *
   * UNIQUE ACROSS THE WHOLE POOL. Two rows for one domain pointing at
   * different accounts is an ambiguity made permanent: whichever row the
   * lookup happened to return would decide where a blog was created, and
   * the two would disagree from one deploy to the next.
   */
  domain: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
  },

  /**
   * Which product publishes to this domain.
   *
   * ADDED 29 October, when Local Website Options needed the same "pick one
   * from a list" that blogs have had since this pool was built. The question
   * a customer is answering is identical — "where does this go?" — so the
   * list they pick from is the same list, and the row says what is behind
   * it.
   *
   * TWO SHAPES IN ONE COLLECTION RATHER THAN TWO COLLECTIONS, because the
   * alternative is two admin screens, two pickers and two sets of rules
   * about what a domain is, for one idea.
   *
   * 'cloudflare' IS THE DEFAULT, AND EVERY STORED ROW IS ONE. This field did
   * not exist until now, so an unset value has to mean the thing every
   * existing row already is — anything else silently re-targets the blogs.
   *
   * 'cfsite' ADDED 7 November, for Cloudflare Websites. Edwin, on why it is
   * a third value rather than a reuse of the first: *"these domains will be
   * separate than the ones for blogs. So the dropdown for these domains has
   * to be separate from the dropdown of those for blogs."*
   *
   * THE NAME IS 'cfsite' AND NOT 'website' BECAUSE 'github' IS ALREADY A
   * WEBSITE. Both of those serve generated sites; they differ in where. A
   * value called `website` would read as the opposite of "blog" and leave
   * the GitHub rows looking like some third thing.
   *
   * ADDING IT FOUND A BUG RATHER THAN CAUSING ONE. /static-blogs asked for
   * `{ enabled: true }` and nothing else, so from the day `github` was
   * added, GitHub domains have been sitting in the blog dropdown. A third
   * value is only what made somebody look.
   *
   *     AN UNFILTERED QUERY DOES NOT MEAN "THE ORIGINAL KIND".
   *     IT MEANS "AND WHATEVER GETS ADDED NEXT" — the same mistake
   *     as an exclusion selector in CSS, in a different language.
   *
   * SO THE FILTERS LIVE IN ONE PLACE: utils/domainPool.js. In particular a
   * filter for the DEFAULT has to allow a MISSING field — mongoose applies
   * `default` on save, not retroactively, so every row written before 29
   * October has no `target` key and `{ target: 'cloudflare' }` does not
   * match it. Only `{ target: { $in: ['cloudflare', null] } }` does.
   */
  target: {
    type: String,
    enum: ['cloudflare', 'github', 'cfsite'],
    default: 'cloudflare',
    index: true,
  },

  /**
   * The Cloudflare account its zone is on.
   *
   * REQUIRED ONLY FOR A CLOUDFLARE ROW, and the reason it is required at all
   * is at the top of this file: Cloudflare writes the DNS record itself only
   * when the zone and the Pages project are on the same account. A GitHub
   * row has no Cloudflare account and must not be made to invent one.
   */
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CloudflareAccount',
    required() { return 'github' !== this.target; },
    index: true,
  },

  /**
   * The GitHub installation whose account serves this domain.
   *
   * ONE DOMAIN, ONE GITHUB ACCOUNT, MANY SITES — Edwin, 29 October, on how
   * the URLs work out: "only one can serve from the root and then other
   * website will use a subdirectory."
   *
   * That account's own `<login>.github.io` repository carries the custom
   * domain, so every other repository on it is served beneath that domain:
   * acme.com/quality-plumbing/, acme.com/roof-pros/. Which GitHub account
   * that is cannot be chosen separately from the domain — they are one
   * choice — which is why it lives on this row rather than on the user or
   * on the job.
   *
   * A NUMBER, NOT A CREDENTIAL. See the note on User.githubInstallationId:
   * it is useless without the App's private key, and a client uninstalling
   * the App revokes it by doing so.
   */
  githubInstallationId: {
    type: String,
    default: '',
    required() { return 'github' === this.target; },
    trim: true,
  },

  /**
   * When the GitHub setup last ran, and whether it finished.
   *
   * WHY A RECORD AND NOT A LIVE CHECK — Edwin, 31 October, looking at two
   * GitHub rows both offering the same button: "I thought I had already
   * done the first one. Will the set up GitHub button always show up?"
   *
   * It did, on every row, whether or not it had been run — because the row
   * knew nothing and the page would have had to ask GitHub four times per
   * domain just to grey out a button.
   *
   *     A BUTTON THAT IS SAFE TO PRESS TWICE IS NOT THE SAME AS
   *     A PAGE THAT CAN TELL YOU WHETHER YOU ALREADY DID.
   *
   * TWO FIELDS, BECAUSE THE JOB HAS TWO HALVES. The repository, the page
   * and Pages are done on GitHub and either worked or threw. The custom
   * domain depends on DNS at a registrar this app has never heard of, and
   * commonly fails the first time — so "it ran" and "it finished" are
   * different facts and the row says which.
   */
  githubSetupAt: { type: Date, default: null },

  githubSetupOk: { type: Boolean, default: false },

  /**
   * What to call it on the dropdown, if the domain alone is not enough.
   *
   * Optional, because for most of them the domain IS the label. It exists
   * for the case where a customer knows their client as "Acme HVAC" and
   * not as the domain somebody registered for them.
   */
  label: { type: String, default: '', trim: true },

  /**
   * Who the domain is registered with — "Namecheap", "Cloudflare", "GoDaddy".
   *
   * A FIELD OF ITS OWN RATHER THAN PART OF `label`, and the reason is in the
   * data. Edwin asked on 14 November for the picker to read
   * "1-1o.com — Namecheap". `label` is where that would naturally go, except
   * the GitHub rows are already using it for something else:
   *
   *     1r2.net -GitHub-claytonringpeter@gmail.com
   *
   * That is a GitHub account note. Putting a registrar in the same box means
   * either losing those notes or printing a client's email address in a
   * customer's dropdown. One box cannot hold two facts.
   *
   * NOTHING KEYS ON IT. Like `label`, it is shown and never matched on, so
   * correcting it is always safe. It is deliberately NOT used to decide
   * anything about DNS: where a domain is REGISTERED and where its
   * nameservers POINT are different questions, and a row saying "Cloudflare"
   * here would still need its zone looked up exactly as it is now.
   */
  registrar: { type: String, default: '', trim: true, maxlength: 60 },

  /**
   * Whether it is offered to customers.
   *
   * A CLIENT LEAVING IS THE CASE THIS IS FOR, and it is deliberately NOT a
   * delete: the blogs already on that domain still have to deploy, and
   * deleting the row would strand them. Off the list, still serving.
   */
  enabled: { type: Boolean, default: true, index: true },

}, { timestamps: true });

module.exports = mongoose.models.Domain
  || mongoose.model('Domain', domainSchema);
