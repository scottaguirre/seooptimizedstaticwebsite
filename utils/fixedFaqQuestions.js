// utils/fixedFaqQuestions.js
//
// Two questions that always lead the FAQ, ahead of the six pulled from
// Google's "People Also Ask".
//
// They cover the two things every visitor wants to know — how do I start,
// and how fast can you move — but the WORDING has to suit the trade.
// "How quickly can you respond to an urgent issue?" is right for a plumber
// and wrong for a law firm, where nobody is dispatched to an emergency, and
// nonsense for a web designer, where the honest answer is "six weeks".
//
// The three type lists and the businessShape() that read them used to live in
// this file — the fourth copy of a mapping that also existed in
// createAboutUsPrompt, createPagesPrompt and createLocationPagesPrompt, and
// had already drifted from all three. They now come from
// utils/businessShape.js.
//
// One behavioural change came with the move: an UNRECOGNISED business type
// used to fall through to 'home'. That default is why a dentist — a type that
// was not in the dropdown at all, and could only arrive through the WordPress
// free-text field — was asked "How do I book a job with Smile Dental?" and
// promised "a written estimate before any work starts". Unknown types now
// resolve to 'generic', which claims nothing.

const { businessShape } = require('./businessShape');

  /**
   * The same two slots — "how do I begin" and "how fast" — worded for the trade.
   */
  const QUESTION_SETS = {
    home: (businessName, service) => ([
      `How do I book a job with ${businessName}?`,
      `How quickly can you respond to an urgent ${service} issue?`,
    ]),
  
    // "my law firm case" reads wrong — the business type is the practice, not
    // the matter. Keep this one free of the type entirely.
    professional: (businessName) => ([
      `How do I get started with ${businessName}?`,
      `How soon can you review my case?`,
    ]),
  
    project: (businessName, service) => ([
      `How do I get started with ${businessName}?`,
      `How long does a typical ${service} project take?`,
    ]),
  
    // "book a job" is what a contractor's customer does; a patient books an
    // appointment. The second slot asks about getting seen rather than about
    // an emergency callout, because a practice does not dispatch anyone.
    medical: (businessName) => ([
      `How do I become a patient at ${businessName}?`,
      `How soon can I get an appointment?`,
    ]),
  
    generic: (businessName) => ([
      `How do I get started with ${businessName}?`,
      `How quickly can you get back to me?`,
    ]),
  };
  
  /**
   * @returns {string[]} exactly two questions, always first in the FAQ
   */
  function getFixedFaqQuestions({ businessName, businessType }) {
    const name = String(businessName || 'us').trim();
    const service = String(businessType || 'service').trim().toLowerCase();
  
    const shape = businessShape(businessType);
    return QUESTION_SETS[shape](name, service);
  }
  
  /**
   * Written fallbacks, used only if the model drops one of the two when
   * answering. Deliberately generic: better a plain accurate answer than a
   * missing question in a section that promises eight.
   */
  function getFixedFaqFallbacks({ businessName, businessType, location }) {
    const name = String(businessName || 'We').trim();
    const service = String(businessType || 'service').trim().toLowerCase();
    const place = String(location || 'your area').trim();
    const shape = businessShape(businessType);
  
    if (shape === 'professional') {
      return [
        `Get in touch by phone or through the contact form and we will arrange an initial consultation. We will talk through your situation, explain the options open to you, and set out the next steps before any commitment is made.`,
        `We aim to review new enquiries within one business day. After that first review we will tell you what is involved, what information we need from you, and a realistic timeframe for the work ahead.`,
      ];
    }
  
    if (shape === 'medical') {
      return [
        `Call the practice or use the contact form and we will book you in. New patients are asked for a short medical history and any records from a previous provider, and we will confirm what to bring before your first visit.`,
        `We keep appointments open each week for new and urgent cases, so most people are seen within a few days. When you get in touch we will tell you the soonest slot available and what the first appointment will cover.`,
      ];
    }
  
    if (shape === 'generic') {
      return [
        `Get in touch by phone or through the contact form and we will talk through what you need. We will explain the options, agree what the work involves, and confirm the cost with you before anything starts.`,
        `We aim to respond to new enquiries within one business day. Once we understand what you are after we will give you a realistic timeframe rather than a guess.`,
      ];
    }
  
    if (shape === 'project') {
      return [
        `Start with a short call or the contact form. We will discuss what you need, agree the scope and deliverables, and send a written proposal covering timeline and cost before work begins.`,
        `Most ${service} projects run a few weeks from kickoff to launch, with the exact schedule set once the scope is agreed. We share progress at each milestone so you always know where the work stands.`,
      ];
    }
  
    return [
      `Call us or use the contact form and we will arrange a visit at a time that suits you. We look at the job on site, explain what needs doing, and give you a written estimate before any work starts.`,
      `For urgent ${service} problems in ${place} we aim to be with you the same day wherever possible. Routine work is usually scheduled within a few days, and we will tell you the arrival window when you book.`,
    ];
  }
  
  module.exports = {
    getFixedFaqQuestions,
    getFixedFaqFallbacks,
    // Re-exported so the handful of callers that imported businessShape from
    // here keep working. New code should require it from ./businessShape.
    businessShape,
  };