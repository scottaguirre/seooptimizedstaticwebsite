// utils/altText/junk-removal.js
//
// Alt text for src/predefined-images/junk-removal/.
//
// ELEVEN SETS, IN FOLDER ORDER: [0] is aboutUs, [1]..[10] are page1..page10.
// The index IS the folder. Reordering this array silently repoints every
// description at a different photograph.
//
// WRITTEN FROM THE PHOTOGRAPHS, ONE AT A TIME.
//
// The first version of this file had three sets and none of them matched the
// images. Set 0 said "commercial crew moving office chairs and filing
// cabinets"; aboutUs/hero is a residential driveway with three workers and a
// dump truck. Set 1 said "moving a large refrigerator out of a residential
// kitchen"; page1/hero is one worker standing in front of an empty garage.
//
// That is worse than the empty alt text the missing sets would have produced.
// alt="" on a decorative image tells a screen reader to skip it; alt text
// describing a different picture tells somebody something untrue and gives
// them no way to know. Plausible-sounding junk-removal sentences are easy to
// write without looking, which is exactly why they have to be checked against
// the file.
//
// So: if the photographs in a folder are ever swapped, the matching set here
// has to be rewritten by opening the new images. Not by editing the words
// until they sound right.

const imageAltText = [

  /* ---- [0] aboutUs ---------------------------------------------------- */
  {
    'hero-mobile': 'Junk removal crew loading furniture and boxes into a black dump truck parked in a suburban driveway',
    'section2-1': 'Workers in hard hats throwing drywall sheets and scrap lumber into a dump truck outside a home garage',
    'section2-2': 'Dump truck at a residential kerb loaded with a sofa, rolled carpet, cardboard boxes and a potted plant',
    'section4-1': 'Two workers carrying a beige sofa down a driveway to a dump truck at sunset while a third loads a mattress',
    'section4-2': 'Loaded dump truck in a driveway beside an armchair, rolled rug and bins set out for removal',
    'section8-1': 'Junk Removal worker smiling at the camera'
  },

  /* ---- [1] page1 ------------------------------------------------------ */
  {
    'hero-mobile': 'Junk removal worker standing in front of an emptied two-car garage with a dump truck parked behind',
    'section2-1': 'Two workers carrying an antique wooden dresser out through a garage doorway lined with storage bins and boxes',
    'section2-2': 'Close view of two workers lifting a wooden dresser by its handles in a room being cleared',
    'section4-1': 'Workers carrying a wooden cabinet out of a garage packed with cardboard boxes, a bicycle and tool cases',
    'section4-2': 'Two workers loading a sofa, chairs, a dresser and boxes into the bed of a blue pickup truck'
  },

  /* ---- [2] page2 ------------------------------------------------------ */
  {
    'hero-mobile': 'White dump truck loaded with lumber and cardboard parked in the driveway of a large suburban home',
    'section2-1': 'Worker pushing a sofa up a ramp into a dump truck while a second worker waits with a hand truck',
    'section2-2': 'Before and after: a driveway piled with furniture, mattresses and rubbish bags, then the same driveway swept clean',
    'section4-1': 'Empty living room with bare hardwood floors and a ceiling fan after a full house clear-out',
    'section4-2': 'The same living room before clearing, filled with stained mattresses, a broken table, an armchair and scattered boxes'
  },

  /* ---- [3] page3 ------------------------------------------------------ */
  {
    'hero-mobile': 'Overhead view of a crew loading a dresser, mattress and boxes into a black dump truck outside a house',
    'section2-1': 'Sofa, bookcase, stacked boxes, dining chairs and a rolled rug set out at the kerb for collection',
    'section2-2': 'Two workers carrying a worn sofa across a driveway toward an open box truck',
    'section4-1': 'Large pile of household junk on a driveway with a bookcase, chairs, mattresses, bicycles and rubbish bags',
    'section4-2': 'Two workers lifting a sofa in a living room beside a rolled rug and bagged rubbish waiting by the front door'
  },

  /* ---- [4] page4 ------------------------------------------------------ */
  {
    'hero-mobile': 'Crew in hard hats clearing renovation debris into a dump truck outside a house with an open garage',
    'section2-1': 'Worker tossing a sheet of drywall onto a truck already loaded with scrap lumber from a renovation',
    'section2-2': 'House interior stripped to the studs with broken drywall, lumber and pink insulation covering the floor',
    'section4-1': 'Two workers throwing drywall and timber offcuts into a dump trailer beside a pile of construction debris',
    'section4-2': 'Pile of drywall, timber and broken concrete on a driveway outside a house under renovation'
  },

  /* ---- [5] page5 ------------------------------------------------------ */
  {
    'hero-mobile': 'Crew loading a sofa, mattress, wooden bench, boxes and a television into a dump trailer in a driveway',
    'section2-1': 'Sofas, a mattress, dressers, a coffee table and chairs lined up along a kerb for removal',
    'section2-2': 'Worker carrying a stained mattress down the hallway of an empty house',
    'section4-1': 'Cluttered bedroom with a mattress, armchair, dresser and open boxes spilling clothes and papers',
    'section4-2': 'The same bedroom emptied and swept, with bare hardwood floor and daylight from the window'
  },

  /* ---- [6] page6 ------------------------------------------------------ */
  {
    'hero-mobile': 'Crew wheeling filing cabinets and office furniture up a ramp into a box truck outside an office building',
    'section2-1': 'Box truck loaded with filing cabinets, office chairs, a refrigerator, desks and rolled carpet',
    'section2-2': 'Two workers wheeling a wooden desk and a refrigerator out through the glass doors of an office lobby',
    'section4-1': 'Rear view of a box truck packed with filing cabinets, office chairs, shelving and a waste bin',
    'section4-2': 'Worker moving a filing cabinet on a hand truck through an open-plan office being cleared'
  },

  /* ---- [7] page7 ------------------------------------------------------ */
  {
    'hero-mobile': 'Three workers clearing rusted patio furniture and scrap metal from a fenced backyard into a dump truck',
    'section2-1': 'Worker loading cut oak branches into a wheelbarrow after storm damage while a colleague loads a truck',
    'section2-2': 'Fallen oak limbs and a collapsed section of wooden fence lying across a lawn after a storm',
    'section4-1': 'Overgrown backyard with a broken patio chair, stacked pallets, loose stone and rubbish bags',
    'section4-2': 'Worker in a hi-vis vest loading branches and a cut log into a black dump trailer'
  },

  /* ---- [8] page8 ------------------------------------------------------ */
  {
    'hero-mobile': 'Crew removing office chairs, filing cabinets and monitors from a glass-fronted office into a box truck',
    'section2-1': 'Two workers securing filing cabinets and wrapped equipment inside a box truck with orange ratchet straps',
    'section2-2': 'Worker carrying a large panel across a gutted office floor while colleagues load cabinets onto a truck ramp',
    'section4-1': 'Worker stacking pallets in a warehouse beside sorted office chairs, cabinets and equipment',
    'section4-2': 'Workers removing shelving units and display racks from an empty retail space'
  },

  /* ---- [9] page9 ------------------------------------------------------ */
  {
    'hero-mobile': 'Three workers easing a stainless steel refrigerator onto a dolly in a kitchen with a truck waiting outside',
    'section2-1': 'Appliance recycling yard with rows of refrigerators, washers and stoves lined up beside cages of scrap',
    'section2-2': 'Four workers wheeling a large wooden armoire and other furniture down a driveway to a box truck',
    'section4-1': 'Two workers guiding an old washing machine down a ramp into a box truck at the kerb',
    'section4-2': 'Two workers carrying a refrigerator across a kitchen on floor protection toward a waiting truck ramp'
  },

  /* ---- [10] page10 ---------------------------------------------------- */
  {
    'hero-mobile': 'Recycling yard with separated skips of scrap aluminium, timber and cardboard beside pallets and stacked electronics',
    'section2-1': 'Three workers clearing desks, chairs and boxes from a high-rise office onto wheeled trolleys',
    'section2-2': 'Scrap metal yard with skips of steel offcuts and pallets of galvanised tube and sections',
    'section4-1': 'Worker carrying an armchair down a truck ramp at a recycling facility past skips and cages of electronics',
    'section4-2': 'Roll-off dumpster filled with drywall, timber, insulation and broken concrete outside a house under renovation'
  }

];

module.exports = imageAltText;
