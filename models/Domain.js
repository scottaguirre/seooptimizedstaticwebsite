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

  /** The Cloudflare account its zone is on. */
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CloudflareAccount',
    required: true,
    index: true,
  },

  /**
   * What to call it on the dropdown, if the domain alone is not enough.
   *
   * Optional, because for most of them the domain IS the label. It exists
   * for the case where a customer knows their client as "Acme HVAC" and
   * not as the domain somebody registered for them.
   */
  label: { type: String, default: '', trim: true },

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
