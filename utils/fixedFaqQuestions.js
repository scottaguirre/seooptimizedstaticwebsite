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
// NOTE: this repeats the categoryMap that also lives in createAboutUsPrompt,
// createPagesPrompt and createLocationPagesPrompt. Four copies is one too
// many and they will drift — worth centralising into a single
// businessCategories module, but as its own change rather than folded into
// this one.

const HOME_SERVICES = [
    'plumbing', 'electrician', 'roofing', 'concrete contractor', 'hvac',
    'air conditioning', 'landscaping', 'fencing', 'junk removal',
    'tree removal', 'paving', 'swimming pool contractor',
    'water damage restoration', 'french drain installation',
  ];
  
  const PROFESSIONAL_SERVICES = [
    'law firm', 'accounting', 'insurance', 'real estate',
  ];
  
  const PROJECT_BASED = [
    'web design', 'web development', 'marketing agency', 'seo agency',
  ];
  
  /**
   * Which of the three shapes a business type takes.
   * Defaults to home services: every type currently supported except law firm
   * is one, so an unmapped value is far more likely to be a new trade than a
   * new professional service.
   */
  function businessShape(businessType = '') {
    const type = String(businessType).toLowerCase().trim();
  
    if (PROFESSIONAL_SERVICES.some(t => type.includes(t))) return 'professional';
    if (PROJECT_BASED.some(t => type.includes(t))) return 'project';
    if (HOME_SERVICES.some(t => type.includes(t))) return 'home';
  
    return 'home';
  }
  
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
    businessShape,
    HOME_SERVICES,
    PROFESSIONAL_SERVICES,
    PROJECT_BASED,
  };