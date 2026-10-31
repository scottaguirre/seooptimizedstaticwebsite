// utils/localOptions/render/legalText.js
//
// The three legal pages, as templates.
//
// TEMPLATED, NOT MODEL-WRITTEN, AND THAT IS THE RULE.
//
// A privacy policy is a legal document. A model inventing one produces
// fluent, plausible text describing practices the site does not have — a
// cookie banner it never shows, a mailing list it never keeps, a retention
// period nobody chose — and the liability for every sentence of it sits with
// the CLIENT, not with us.
//
// So these describe only what the site demonstrably does: a contact form
// whose contents go to the business, and an embedded Google map. Nothing
// else is claimed, because nothing else happens.
//
// EACH ONE ENDS BY SAYING IT IS NOT LEGAL ADVICE. Not as a disclaimer to
// hide behind — as the honest statement of what a generated page can be. The
// owner is told to have somebody check it.
//
// THE PHONE NUMBER AND THE ADDRESS ARE SUBSTITUTED, nothing else. If a
// sentence here needs a fact the business object does not carry, the
// sentence is wrong, not the business object.

'use strict';

/**
 * Build the three bodies for one business.
 *
 * A FUNCTION RATHER THAN A CONSTANT, because two of the three name the
 * business. Returned as structured sections — `{ heading, paragraphs }` —
 * so pages.js renders them with the same code that renders a service page,
 * rather than holding a second copy of the prose markup.
 *
 * @param {object} business
 * @returns {Object<string, Array<{heading:string, paragraphs:string[]}>>}
 */
function legalSections(business = {}) {
  const name = business.name || 'this business';
  const phone = business.phone || '';
  const where = [
    business.street,
    business.city,
    [business.state, business.zip].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');

  const NOT_ADVICE = {
    heading: 'A note from whoever publishes this',
    paragraphs: [
      'This text is a plain description of how the site works. It is not legal '
      + 'advice and it has not been reviewed by a lawyer. State law differs, and '
      + 'it is worth having somebody check it against your own practices.',
    ],
  };

  return {
    'privacy-policy': [
      {
        heading: '',
        paragraphs: [
          'This page explains what this website collects and what happens to it. '
          + 'It describes this website only.',
        ],
      },
      {
        heading: 'What the site collects',
        paragraphs: [
          'Nothing is collected automatically beyond the standard request '
          + 'information your browser sends to the host — the page requested, the '
          + 'time, and a general location derived from the connection. No analytics '
          + 'or advertising scripts run on this site.',
          'If you use the contact form, the details you type are sent to the '
          + 'business and used to answer you. They are not sold and not passed to '
          + 'anyone else.',
        ],
      },
      {
        /* THE MAP IS DECLARED, because it is the one third party on the
         * page. A visitor's browser contacts Google on page load whether or
         * not they touch the map, and a privacy policy that does not say so
         * is inaccurate about the only thing it needed to cover. */
        heading: 'The map',
        paragraphs: [
          'The location map is embedded from Google Maps. Loading a page that '
          + 'contains the map means your browser contacts Google, and Google may set '
          + 'cookies and record the request. That is Google’s processing, under '
          + 'Google’s privacy policy, and it happens whether or not you interact '
          + 'with the map.',
        ],
      },
      {
        heading: 'Getting in touch about your information',
        paragraphs: [
          where && phone
            ? `Write to ${name}, ${where}, or call ${phone}.`
            : `Get in touch with ${name} using the details on the contact page.`,
        ],
      },
      NOT_ADVICE,
    ],

    'terms-of-use': [
      {
        heading: '',
        paragraphs: [
          'These terms cover the use of this website. They do not cover any work '
          + 'carried out at your property, which is agreed separately in writing.',
        ],
      },
      {
        heading: 'The information here',
        paragraphs: [
          'Pages describing the work are general. They are not a quote, a diagnosis '
          + 'or a promise about any particular job. Prices and timescales depend on '
          + 'what is found on the day.',
          'We keep the pages current, but a page can be out of date between one '
          + 'visit and the next.',
        ],
      },
      {
        heading: 'Content',
        paragraphs: [
          'The text, photographs and layout belong to the business. Please do not '
          + 'copy them for another site.',
        ],
      },
      {
        heading: 'Links',
        paragraphs: [
          'Where this site links elsewhere, the linked site is not under our '
          + 'control and we are not responsible for what it contains.',
        ],
      },
      {
        heading: 'A note from whoever publishes this',
        paragraphs: [
          'This text is not legal advice and has not been reviewed by a lawyer.',
        ],
      },
    ],

    accessibility: [
      {
        heading: '',
        paragraphs: [
          'This site is built to be usable with a keyboard, a screen reader and at '
          + 'a large text size.',
        ],
      },
      {
        /* EVERY CLAIM HERE IS ONE THE RENDERER ACTUALLY MAKES TRUE. The skip
         * link, the landmark, the heading order, the alt text and the links
         * being links are all in chrome.js and pages.js, and the suites
         * assert them. An accessibility statement describing a site that
         * does not behave that way is worse than none. */
        heading: 'What has been done',
        paragraphs: [
          'Every page is one column of ordinary HTML with headings in order. Images '
          + 'carry alternative text. Links are links rather than scripted elements, '
          + 'so they work without JavaScript. Text and background colours were '
          + 'chosen to stay legible when the page is zoomed.',
          'There is a skip link at the top of each page, and the main content is '
          + 'inside a landmark a screen reader can jump to.',
        ],
      },
      {
        heading: 'Known gaps',
        paragraphs: [
          'The embedded map comes from Google and we do not control how it behaves '
          + 'with assistive technology. The address and the hours are written out in '
          + 'text above it for that reason, so nothing is only available inside the '
          + 'map.',
        ],
      },
      {
        /* THE SAME NOTE THE OTHER TWO CARRY, WORDED FOR THIS PAGE.
         *
         * The first draft left it off, on the reasoning that an
         * accessibility statement is not a legal document the way a privacy
         * policy is. It is: "built to be usable with a screen reader" is a
         * CONFORMANCE CLAIM, published by the client, about a site nobody
         * audited. Saying what it is not costs one sentence. */
        heading: 'What this page is not',
        paragraphs: [
          'This is a description of how the site was built. It is not a '
          + 'conformance claim against WCAG, the ADA or any other standard, and '
          + 'the site has not been audited against one. It is not legal advice.',
        ],
      },
      {
        heading: 'If something is hard to use',
        paragraphs: [
          phone
            ? `Call ${phone} and say what you were trying to do. It will be fixed, `
              + 'and in the meantime somebody will give you the information over the '
              + 'phone.'
            : 'Get in touch and say what you were trying to do. It will be fixed, '
              + 'and in the meantime somebody will give you the information another '
              + 'way.',
        ],
      },
    ],
  };
}

module.exports = { legalSections };
