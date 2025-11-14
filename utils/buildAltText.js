const { slugify } = require('./slugify');

const imageDesc = {
  plumbing: [

                {
                  'hero-mobile': 'a male plumber fixing a pipe connection',
                  'section2-1': 'a male plumber fixing a water heater',
                  'section2-2': 'a male plumber fixing a toilet',
                  'section4-1': 'a male plumber smiling at the camera',
                  'section4-2': 'a male plumber installing a toilet'
                },
                {
                  'hero-mobile': 'male plumber fixing a bathroom faucet',
                  'section2-1': 'water softener installation',
                  'section2-2': 'male plumber fixing a sink pipe',
                  'section4-1': 'a pipe with a water leak',
                  'section4-2': 'a male plumber uncloging a sink'
                },
                {
                  'hero-mobile': 'a male plumber technician smiling at the camera',
                  'section2-1': 'a group of plumbing tools and fittings',
                  'section2-2': 'a male plumber installating a water heater',
                  'section4-1': 'a male technician shaking hands with the customer',
                  'section4-2': 'a male technician tightening a ball valve'
                },
                {
                  'hero-mobile': 'a plumber technician with a tool belt',
                  'section2-1': 'pvc pipes underground',
                  'section2-2': 'a male plumber installing a garbage disposal',
                  'section4-1': 'a backflow prevention system',
                  'section4-2': 'sink pipe leaking and some tools on the floor'
                }
                ,
                {
                  'hero-mobile': 'The torso of plumbing technician showing a tool belt',
                  'section2-1': 'PVC pipes going underground',
                  'section2-2': 'A technician working on a garbage disposal',
                  'section4-1': 'A water preasure reducing valve',
                  'section4-2': 'A sink water leak and plumbing tools on the floor'
                },
                {
                  'hero-mobile': 'A plumbing technician putting his tool box back in his van',
                  'section2-1': 'A plumber checking a toilet',
                  'section2-2': 'A plumber working on a tankless water heater',
                  'section4-1': 'A woman on the phone with a water leak problem underneath the kitchen sink',
                  'section4-2': 'A plumber using a snake to clear a plumbing pipe'
                } ,
                {
                  'hero-mobile': 'One rusted water heater next to a brand new water heater',
                  'section2-1': 'A male plumber working on a water heater hanging from the wall',
                  'section2-2': 'A male plumber working on a water heater connection',
                  'section4-1': 'A male plumber smiling and posing to the camera',
                  'section4-2': 'A male plumber with a screwdriver fixing a garbage diposal'
                },
                {
                  'hero-mobile': 'A male plumber fixing an outdoor faucet',
                  'section2-1': 'A wooried plumber looking at a frozen pipe',
                  'section2-2': '4 plumbing technician posing for the camera',
                  'section4-1': 'A plumber running a snake to clear a bathtub drain',
                  'section4-2': 'A plumber working on commercial pipe connections'
                } ,
                {
                  'hero-mobile': '2 male plumbers looking at the camera',
                  'section2-1': 'A worried plumber in a flooded room',
                  'section2-2': 'A plumbing technician using a tool to fix a water faucet',
                  'section4-1': 'A male plumber checking a kitchen sink pipe connection',
                  'section4-2': 'A tankless water heater'
                },
                {
                  'hero-mobile': 'A male plumbing technician tightening a water heater connection',
                  'section2-1': 'A sad woman looking a broken garbage disposal',
                  'section2-2': 'Water leaking from PVC pipes',
                  'section4-1': 'A technician fixing bathroom a water faucet',
                  'section4-2': 'A toilet with some plumbing tools laying next to it on the floor'
                } ,
                {
                  'hero-mobile': 'A male plumbing technician tightening a sink pipe',
                  'section2-1': '3 water heaters',
                  'section2-2': 'A male plumbing technician fixing a garbage disposal',
                  'section4-1': 'A male plumber fixing a sink pipe',
                  'section4-2': 'A male plumber unclogging a bathtub drain'
                }
            ],
  'concrete-contractor': [
                
                {
                  'hero-mobile': '3 concrete contractors spreading concrete on the ground',
                  'section2-1': 'a stamped concrete patio',
                  'section2-2': 'a finished concrete house floor',
                  'section4-1': 'a male worker finishing a concrete driveway',
                  'section4-2': 'a male worker finishing an outdoor concrete slab'
                },
                {
                  'hero-mobile': 'a concrete truck pouring cement on a concrete form',
                  'section2-1': 'concrete foundation to build a new house',
                  'section2-2': 'a concrete contractor smiling at the camera with stamped concrete behind him',
                  'section4-1': 'a white cement truck',
                  'section4-2': 'a stamped concrete patio being finished'
                },
                {
                  'hero-mobile': 'a male concrete worker spreading fresh cement on rebared ground',
                  'section2-1': 'a brand new finished stamped concrete patio',
                  'section2-2': 'a house featuring a concrete patio',
                  'section4-1': '3 concrete workers pouring and spreading cement on the ground',
                  'section4-2': 'a male concrete worker adding cement to a walkway'
                },
                {
                  'hero-mobile': 'Cement truck pouring cement on a rebared ground',
                  'section2-1': 'a new concrete floor for a room',
                  'section2-2': '4 workers pouring and spreading concrete on the ground',
                  'section4-1': 'a concrete worker using a machine to finish a concrete foundation',
                  'section4-2': 'a male worker repairing a sidewalk'
                },
                {
                  'hero-mobile': 'a concrete patio with a pergola',
                  'section2-1': 'a male worker working on a concrete stamped project',
                  'section2-2': 'a brand new stamped concrete patio finished',
                  'section4-1': 'a male worker smoothing a fresh concrete slab',
                  'section4-2': 'a male worker leveling a concrete slab porch'
                },
                {
                  'hero-mobile': 'a brand new concrete driveway',
                  'section2-1': '2 workers spreading fresh cement on a rebared ground',
                  'section2-2': 'a hand trowel being used on a fresh cement slab',
                  'section4-1': 'a new house concrete foundation',
                  'section4-2': 'a new concrete floor for a house'
                },
                {
                  'hero-mobile': 'a swimming pool concrete deck',
                  'section2-1': 'a stamped concrete patio',
                  'section2-2': 'a man spreading the cement that a truck is pouring on the ground',
                  'section4-1': 'a finished concrete foundation for a new house',
                  'section4-2': '4 workers pouring and spreading concrete on the ground'
                },
                {
                  'hero-mobile': 'a concrete porch and sidewalk',
                  'section2-1': 'a stamped concrete being sprayed',
                  'section2-2': 'a red epoxy floor',
                  'section4-1': '2 men using a machine to finish a concrete slab foundation',
                  'section4-2': 'a section of a concrete patio'
                },
                {
                  'hero-mobile': 'a man spreading the cement a truck is pouring to build a patio',
                  'section2-1': 'a cement truck pouring cement on a rebared ground',
                  'section2-2': '3 concrete workers spreading cement on the ground',
                  'section4-1': 'a new concrete foundation for a house',
                  'section4-2': 'a white cement truck'
                },
                {
                  'hero-mobile': '3 concrete contractors spreading concrete on the ground for a sidewalk',
                  'section2-1': '4 workers in uniform similing at the camera',
                  'section2-2': 'a concrete worker using a piece of wood to spread fresh cement for a sidewalk',
                  'section4-1': 'a house featuring a new concrete patio',
                  'section4-2': 'a red epoxy floor'
                },
                {
                  'hero-mobile': 'a hand trowel being used on a fresh cement slab to smooth it',
                  'section2-1': 'a new concrete foundation for a house',
                  'section2-2': 'a swimming pool concrete deck',
                  'section4-1': 'a concrete floor for a new building',
                  'section4-2': 'a brand new concrete floor for a new building'
                }     

            ],

  'hvac': [
            
            {
              'hero-mobile': 'a male hvac technician checking an ac unit',
              'section2-1': 'commercial ducts installation',
              'section2-2': 'a male hvac technician looking straight at the camera',
              'section4-1': 'a male hvac technician replacing an ac filter',
              'section4-2': 'a male hvac technician fixing a mini split ac'
            },
            {
              'hero-mobile': '2 hvac technicians replacing a filter of an outside ac unit',
              'section2-1': 'a male hvac technician checking a commercial ac unit on the roof of the building',
              'section2-2': 'an ac unit outside with an ac manifold gauge next to it',
              'section4-1': 'an hvac technician checking a mini split ac',
              'section4-2': 'an hvac technician with an ipad filling out a report'
            },
            {
              'hero-mobile': 'an hvac technician with his tools checking an outside ac unite',
              'section2-1': 'an hvac technician using a scredriver to check the wires of an ac unite',
              'section2-2': 'an hvac technician smiling at the camera',
              'section4-1': 'an hvac technician using a ac current meter',
              'section4-2': 'the hand of a person using an AC control remote to adjust the temperature'
            },
            {
              'hero-mobile': 'an hvac technician in uniform using the manifold gauge to test an ac unit',
              'section2-1': 'an hvac technician using a small freon tank to refill an ac unit',
              'section2-2': 'an hvac technician holding a wireless temperature meter to check a vent temperature',
              'section4-1': 'an hvac technician holding and checking an ac filter',
              'section4-2': 'an hvac technician cleaning the ducts with a machine'
            },
            {
              'hero-mobile': 'Metal air ducts',
              'section2-1': 'a male hvac technician with a tool bag smiling at the camera',
              'section2-2': 'a male hvac technician measuring the temperature with a device',
              'section4-1': 'metal air ducts attached to the ceiling of a building',
              'section4-2': 'a white AC unit outside a building'
            },
            {
              'hero-mobile': 'a family outside the house smiling at the camera with a new AC unit next to them',
              'section2-1': 'a male hvac technician checking a mini split AC unit',
              'section2-2': '2 AC units outside the house on a concrete slabs next to each other',
              'section4-1': 'a male hvac technician checking a furnace wiring',
              'section4-2': 'an AC duct very dirty on the inside'
            },
            {
              'hero-mobile': 'an orange cat laying on the carpet next to an AC vent',
              'section2-1': 'a hand holding a thermostat showing 72 degree cooling',
              'section2-2': 'a mini split AC unit mounted on the wall',
              'section4-1': 'a male hvac technician using a current meter on a furnace unit',
              'section4-2': 'a male hvac technician on the roof checking an AC unit'
            },
            {
              'hero-mobile': 'a brand new AC unit outside on a concrete slab',
              'section2-1': 'a mini split AC unit and an traditional AC unit showing',
              'section2-2': 'a male hvac technician using a scredriver to open an AC unit',
              'section4-1': 'a mini split AC unit mounted on a wall and the thermostat below it',
              'section4-2': 'a male hvac technician cleaning the coils of an old AC unit'
            },
            {
              'hero-mobile': 'a male hvac techinican using a screwdriver to open a mini split unit and smiling at the camera',
              'section2-1': 'a male hvac technician smiling and giving a thumbs-up at the camera',
              'section2-2': 'an hvac technician cleaning the coils of an AC unit',
              'section4-1': 'a cool air stream coming out of a vent',
              'section4-2': 'a family on a couch enjoying the cool air coming from a mini split AC unit'
            },
            {
              'hero-mobile': 'an hvac technician on the front porch smiling at the camera and an AC unit next to him',
              'section2-1': 'a family cuddling on the couch next to the house furnace',
              'section2-2': 'a dirty AC duct on the inside next to a clean AC duct on the inside',
              'section4-1': '3 hvac technician ouside a house smiling at the camera',
              'section4-2': 'a fog meter device in the living room of a house'
            },
            {
              'hero-mobile': 'traditional AC ducts installed in the attic of a house',
              'section2-1': 'AC tools on the tailgate of a truck',
              'section2-2': 'an hvac technician with a screwdriver checking the wiring of a furnace',
              'section4-1': '2 hvac technician smiling at the camera',
              'section4-2': 'an hvac technician fixing a mini split AC unit'
            }     

        ],

  'fencing': [
            
            {
              'hero-mobile': 'a fence contractor smiling at the camera with a new fence built behind him',
              'section2-1': 'a happy family in the backyard with a stained wooden fence behind them',
              'section2-2': 'two male fence contractors measuring the length of a new fence addition',
              'section4-1': 'a before and after image with a house without a fence and the house with a new fence',
              'section4-2': 'a building featureing a new metal gate fence'
            },
            {
              'hero-mobile': 'a male fence contractor giving a thumbs up to the camera with a wooden fence in the background',
              'section2-1': 'two male contractors installing a new fence gate',
              'section2-2': 'a beautiful white fence with backyard lights on connect them to it',
              'section4-1': 'a building featuring a gated metal fence',
              'section4-2': 'an electric substation surrounded by a chain fence'
            },
            {
              'hero-mobile': 'a house featuring a new stained wooden fence around it',
              'section2-1': 'a house featuring a modern style fence around it',
              'section2-2': 'a male fence contractor checking the level a new fence',
              'section4-1': 'metal and wooden 2 x 4 fence posts',
              'section4-2': 'a hinge, some screws and other fence material'
            },
            {
              'hero-mobile': 'a galvanized metal fence',
              'section2-1': 'a wooden fence with the sunset as background',
              'section2-2': 'a piquet wooden fence with the sunset in the background',
              'section4-1': 'A fully fenced-in property used for commercial sawing',
              'section4-2': 'a fence contractor smiling at the camera with a brand new fenced installed in the background'
            },
            {
              'hero-mobile': '2 male fence contractors building a new fence',
              'section2-1': 'a house backyard with a stained fence',
              'section2-2': 'a house featuring a white vinyl fence',
              'section4-1': 'a house featuring a wooden fence from the outside view',
              'section4-2': 'a house backyard with a metal fence'
            },
            {
              'hero-mobile': 'a house backyard showin a white fence',
              'section2-1': 'a fenced-in swimming pool',
              'section2-2': '2 male contractors using each a drill to build a new fence',
              'section4-1': '2 male contractors installing a chained fence',
              'section4-2': 'a beautiful backyard showing a metal fence from the outside view'
            },
            {
              'hero-mobile': 'a female and male fence contractor installing a new wooden fence',
              'section2-1': 'a male fence contractor securing a metal fence post with cement',
              'section2-2': '2 male fence contractors installing the posts for a new fence',
              'section4-1': 'a male contractor welding a new metal fence',
              'section4-2': '2 male contractors installing the posts for a new wooden fence'
            },
            {
              'hero-mobile': '4 fence contractors in uniform smiling at the camera',
              'section2-1': '2 male fenc contractors cutting a piece of wood',
              'section2-2': 'a contractor securing a metal post with cement',
              'section4-1': '2 male fence contractors welding a new metal fence',
              'section4-2': 'a country house with featuring a fence'
            },
            {
              'hero-mobile': 'a happy family on a wooden deck with a fence',
              'section2-1': '2 contractors smiling at the camera with a fence in the background',
              'section2-2': 'a metal fence aound a house',
              'section4-1': '2 kids playing in the backyard with a fence in the background',
              'section4-2': 'a happy dog with an iron fence in the background'
            },
            {
              'hero-mobile': 'a fence contractor shaking hand with a happy customer',
              'section2-1': 'a fence contractor installing a fence post',
              'section2-2': 'a fence contractor showing the new fence he installed',
              'section4-1': 'a commercial bulding surrounded by a chained fence ',
              'section4-2': 'a commercial building with a metal fence around it'
            },
            {
              'hero-mobile': 'an image of 4 types of fence, wooding, vinyl, aluminum and composite',
              'section2-1': 'a house fence with a wooden gate',
              'section2-2': 'a fence contractor giving a thumbs up to the camera and a fence in the background',
              'section4-1': 'a house with an aliminum fence',
              'section4-2': 'a wooden fence with water from the rain on it'
            }     

        ],
  'law-firm': [
            
            {
              'hero-mobile': 'a man taking a picture with his phone under the hood of his lemon car',
              'section2-1': 'a man taking a report from the owner of a lemon car',
              'section2-2': 'a lawyer in his office explaining the lemon law to a customer',
              'section4-1': 'a lawyer giving a presentation with some statistics of vehicle repair history',
              'section4-2': 'a woman representative holding a contract at a car dealership'
            },
            {
              'hero-mobile': 'a male lawyer smiling at the camera with a lemon car in the background',
              'section2-1': 'a female representative pointing with a pen to a car sales contract',
              'section2-2': 'a lemon law lawyer in his office reading a bill of sales and purchase agreement',
              'section4-1': 'a lemon law lawyer shaking hands with a customer in his office',
              'section4-2': 'a lemon law lawyer handing a check to his customer after winning his case'
            },
            {
              'hero-mobile': 'legal documents on top of a desk in a lemon law office',
              'section2-1': 'a lawyer seating at his desk with a sign next to him that says lemon law',
              'section2-2': 'a lemon law attorney smiling at the camera',
              'section4-1': 'a lawyer with an ipad explaining something to his client',
              'section4-2': 'a key set on top of a folder that says case won'
            },
            {
              'hero-mobile': 'a lwayer in his office showing a laptop screen that says lemon law firm',
              'section2-1': 'a gavel with some car keys next to it',
              'section2-2': 'a lawyer walking with a customer and both are smiling',
              'section4-1': 'A lawyer seating at his office reading legal documents',
              'section4-2': 'a scale of justice on a lawyer office desk '
            },
            {
              'hero-mobile': 'a scale of justice with some legal documents next to it',
              'section2-1': 'the front entrance of a law firm building',
              'section2-2': 'a lawyer handing a man a business card',
              'section4-1': 'a lawyer having a video call meeting with a client',
              'section4-2': 'a lemon law lawyer smilig as he shows a contract to a woman'
            },
            {
              'hero-mobile': 'a lawyer using a tv screen to give a presentation',
              'section2-1': 'a lawyer walking in a hall with a briefcase',
              'section2-2': 'a lawyer walking down the stairs of a courthouse entrance',
              'section4-1': 'a female lawyer reading a legal book',
              'section4-2': 'the waiting area of a law firm'
            },
            {
              'hero-mobile': 'a lawyer using a pen to highlight a document',
              'section2-1': 'a female lawyer reading a document outside of a coffee place',
              'section2-2': 'a male lawyer reading a legal book',
              'section4-1': 'a male lawyer holding a book while posing for the camera',
              'section4-2': 'a lawyer with a client reviewing a document'
            },
            {
              'hero-mobile': 'the statue of lady justice',
              'section2-1': 'a young lawyer smiling at the camera',
              'section2-2': 'a young lawyer focused reading a legal document',
              'section4-1': 'a lawyer talking to a youg couple in his office',
              'section4-2': 'an empty office with bookshelves and the scale of justice on the desktop'
            },
            {
              'hero-mobile': 'a group of lawyers in a meeting',
              'section2-1': 'a lawyer reviewing a legal document',
              'section2-2': 'a female lawyer talking on her phone while holding a legal document',
              'section4-1': 'a male lawyer talking on his phone while holding a legal document',
              'section4-2': '4 lawyers walking down the hall of a building'
            },
            {
              'hero-mobile': '2 hands shaking closing a deal and a legal document underneath them;',
              'section2-1': 'a lawyer presenting his case in a court room',
              'section2-2': '3 lawyers in an office discussing a legal case',
              'section4-1': '4 lawyers celebrating with champagne they won a case',
              'section4-2': 'a female lawyer in a court room writing on her notes'
            },
            {
              'hero-mobile': '4 lawyers happy and smiling at the camera',
              'section2-1': 'a scale of justice on a desk with the amercian flag in the background',
              'section2-2': 'a female lawyer showing some data from her laptop',
              'section4-1': 'a lawyer talking to a client on the street while holding a clipboard that says lemon law',
              'section4-2': 'a young lawyer smiling at the camera'
            }     

        ]

};


function buildAltText(globalValues, index) {
  const name = globalValues.businessName;
  const location = globalValues.location;
  const businessType = slugify(globalValues.businessType);
  const imageSets = imageDesc[businessType];
  let selectedSet;

  if(!imageSets) {
    console.warn(`⚠️ No image descriptions found for business type: ${globalValues.businessType}`);
    return {};
  }


  
  if(index === 'aboutIndex'){ // aboutIndex means it's coming from buildAboutUsPage.js
    selectedSet = imageSets[0];
  }else{
    const imageIndex = index % 10;
    selectedSet = imageSets[imageIndex + 1];
  }
   


  const result = {};

  for (const [key, desc] of Object.entries(selectedSet)) {
    result[key] = `${desc} from ${name} in ${location}`;
  }

  return result;
}


module.exports = { buildAltText };
