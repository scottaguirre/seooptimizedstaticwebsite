// blog-engine-preview/campaign.example.js
//
// One campaign, using the real Leander plumbing site so the output is
// judgeable rather than abstract. Edit the topics and re-run.
//
// In production this object is what the plugin builds from the owner's form
// and posts to your server — so its shape is worth settling here.

module.exports = {
    siteUrl: 'https://qualityplumberleander.com',
  
    business: {
      name: 'Quality Plumbing Leander',
      trade: 'Plumber',
      town: 'Leander, TX',
      services: [
        'Water Heater Repair',
        'Water Heater Installation',
        'Faucet Installation',
        'Drain Cleaning',
        'Leak Detection',
        'Sewer Line Repair',
      ],
    },
  
    // The page the whole campaign exists to push. Note it is a SERVICE page,
    // not a blog pillar — a blog post on the same subject would compete with it.
    targetPage: {
      title: 'Water Heater Repair',
      keyword: 'water heater repair',
      url: 'https://qualityplumberleander.com/water-heater-repair-leander-tx/',
  
      // WHAT THE READER SHOULD END UP WANTING.
      //
      // The keyword alone is not enough. Given only "water heater repair" the
      // model generates around the whole subject, and half the topics come back
      // about REPLACEMENT — posts that argue the reader should not repair, while
      // linking to the repair page. Those links then describe the target as a
      // replacement page, which is the opposite of the campaign's purpose.
      //
      // Write this as a sentence about the person, not a keyword.
      intent: 'have an existing water heater diagnosed and repaired, rather than replaced',
    },
  
    // Publish order. Four is enough to exercise the ring: 1→2→3→4→1.
    //
    // targetQuery is the ONE search each post is meant to win. Two posts on the
    // same query split their strength; a query that IS the service page's search
    // competes with the page the campaign exists to promote. queryConflicts()
    // catches both before anything is written.
    //
    // linkPhrase is how OTHER posts refer to this one in a sentence. It is not
    // the title: a title is a headline, an anchor is a noun phrase that has to
    // read naturally mid-sentence. Truncating the title gives you "signs your
    // water heater is", which is why this is a separate field.
    //
    // In production the model writes these once, at plan time, alongside the
    // anchor pool.
    topics: [
      {
        "topic": "A Pilot Light That Keeps Going Out Needs More Than a Relight",
        "targetQuery": "water heater pilot light keeps going out",
        "linkPhrase": "a pilot light that will not stay lit",
      },
      {
        "topic": "Leander’s Hard Water Can Leave Hot Water Lukewarm",
        "targetQuery": "hard water water heater problems",
        "linkPhrase": "hard water effects on a water heater",
      },
      {
        "topic": "What Happens During a Water Heater Diagnosis Visit",
        "targetQuery": "what does a water heater inspection include",
       "linkPhrase": "what to expect during a diagnosis visit"
      },
      {
        "topic": "At Ten Years, Many Water Heater Problems Are Still Repairable",
    "targetQuery": "ten year old water heater problems",
    "linkPhrase": "what remains repairable at ten years",
      },
    ],
  
    // Phrases the writer may use to link to the target page.
    //
    // In production the model generates this pool once per campaign and it is
    // stored against the target page, so variety accumulates across campaigns
    // rather than resetting. Hard-coded here so the harness is deterministic.
    anchorPool: {
      exact: [
        'water heater repair',
      ],
      semantic: [
        'water heater repair in Leander',
        'repairing a leaking water heater',
        'emergency water heater service',
        'fixing a failing water heater',
        'water heater diagnosis and repair',
      ],
      descriptive: [
        'what a repair usually involves',
        'how we handle a failed heater',
        'what a replacement typically costs',
      ],
      branded: [
        "Quality Plumbing Leander's water heater service",
      ],
    },
  
    // Anchors already pointing at this page from earlier campaigns. Empty on a
    // first run; in production it comes from stored post meta.
    usedAnchors: new Set(),
  
    everyDays: 30,
    startDate: new Date('2026-03-02T09:00:00Z'),
  };