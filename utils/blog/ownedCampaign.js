// utils/blog/ownedCampaign.js
//
// "Is this campaign yours?" — asked by five callers, answered in one place.
//
// WHY IT LEFT THE ROUTE
//
// It lived in blogApiRoute.js, where four handlers call it. approveCampaign
// is the fifth, and it is not a handler: it is called from the route AND from
// the Cloudflare screen, so it cannot reach for `req`.
//
// Rather than let the screen skip the check — which is how a tenancy hole
// gets made — the check moved out and takes what it actually needs. The
// route keeps a one-line wrapper so its other four call sites are untouched.
//
// NOTHING ELSE CHANGED. Same regex, same lookup, same security log, same
// null for both failures.

'use strict';

const BlogCampaign = require('../../models/BlogCampaign');
const { log } = require('../logger');

/**
 * Find a campaign this site is allowed to touch.
 *
 * The signature proved which SITE is calling; this proves the campaign
 * belongs to it. Without the check, any activated site could read any other
 * customer's posts by guessing a campaign id — and campaign ids appear in
 * wp-admin, so they are not secret.
 *
 * Returns null for both "no such campaign" and "not yours", and the caller
 * answers 404 either way. Telling the two apart would turn this into a way
 * to enumerate other people's campaigns.
 *
 * @param {object} opts
 * @param {object} opts.site        the BlogSite making the request
 * @param {string} opts.campaignId  as it arrived, trusted for nothing
 * @param {string} opts.requestId   for the log line
 */
async function ownedCampaign({ site, campaignId, requestId }) {
  if (!/^[a-f0-9]{24}$/i.test(String(campaignId || ''))) return null;

  const campaign = await BlogCampaign.findById(campaignId);
  if (!campaign) return null;

  if (String(campaign.site) !== String(site._id)) {
    log.security('blog.wrongSite', {
      requestId,
      siteId: String(site._id),
      campaignId: String(campaignId),
    });
    return null;
  }

  return campaign;
}

module.exports = { ownedCampaign };
