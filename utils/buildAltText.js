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
                  'section2-1': 'a male concrete worker smoothing the concrete slab with a machine',
                  'section2-2': '2 concrete workers spreading concrete on a rebared ground',
                  'section4-1': 'Cement truck pouring cement on a rebared ground',
                  'section4-2': 'a mconcrete slab foundation already finished'
                },
                {
                  'hero-mobile': 'a concrete truck pouring cement on a rectangle form',
                  'section2-1': 'a white cement truck',
                  'section2-2': '2 concrete workers finishing a concrete slab foundation',
                  'section4-1': 'a finished stamped concrete patio',
                  'section4-2': 'a concrete contractor smiling at the camera'
                },
                {
                  'hero-mobile': 'a male concrete worker spreading fresh cement on rebar',
                  'section2-1': 'a brand new finished stamped concrete patio',
                  'section2-2': 'a house featuring a concrete patio',
                  'section4-1': '3 concrete workers pouring and spreading cement on ground',
                  'section4-2': 'a male concret worker adding cement to a walkway'
                }
                

            ]
};


function buildAltText(globalValues, pageIndex, page) {
  // Reuse from 0 to 3 repeatedly
  const name = globalValues.businessName;
  const location = globalValues.location;
  const businessType = slugify(globalValues.businessType);
  const imageSets = imageDesc[businessType];

  if(!imageSets) {
    console.warn(`⚠️ No image descriptions found for business type: ${globalValues.businessType}`);
    return {};
  }
  const imageIndex = pageIndex % imageSets.length;
  const selectedSet = imageSets[imageIndex];

  

  const result = {};

  for (const [key, desc] of Object.entries(selectedSet)) {
    result[key] = `${desc} from ${name} in ${location}`;
  }

  return result;
}


module.exports = { buildAltText };
