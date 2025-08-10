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
