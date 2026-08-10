// Shared alt text sets for the HVAC / air conditioning trades.
//
// These two categories describe the same photo set with a different trade name,
// so they share one source of truth here. Pass the trade noun:
//   require('./_hvacBase')('HVAC')
//   require('./_hvacBase')('air conditioning')
//
// Note: every occurrence uses "an <trade> technician", which reads correctly for
// both "an HVAC technician" and "an air conditioning technician".
//
// Index 0 is reserved for the About Us page (it carries the extra 'section8-1' key).
// Indexes 1-10 are the rotation used by content pages.

module.exports = (trade) => {
  const tech = `${trade} technician`;

  return [
    {
      'hero-mobile': `a male ${tech} checking an AC unit`,
      'section2-1': 'commercial duct installation',
      'section2-2': `a male ${tech} looking straight at the camera`,
      'section4-1': `a male ${tech} replacing an AC filter`,
      'section4-2': `a male ${tech} fixing a mini-split AC`,
      'section8-1': `a male ${tech} smiling at the camera`
    },
    {
      'hero-mobile': `a male ${tech} testing an outdoor AC unit`,
      'section2-1': `a male ${tech} checking a commercial AC unit on the roof of a building`,
      'section2-2': 'an outdoor AC unit with an AC manifold gauge next to it',
      'section4-1': `an ${tech} checking a mini-split AC`,
      'section4-2': `an ${tech} filling out a report on an iPad`
    },
    {
      'hero-mobile': `an ${tech} with his tools checking an outdoor AC unit`,
      'section2-1': `an ${tech} using a screwdriver to check the wires of an AC unit`,
      'section2-2': `an ${tech} smiling at the camera`,
      'section4-1': `an ${tech} using an AC current meter`,
      'section4-2': 'the hand of a person using a remote to adjust the AC temperature'
    },
    {
      'hero-mobile': `an ${tech} in uniform using a manifold gauge to test an AC unit`,
      'section2-1': `an ${tech} using a small freon tank to refill an AC unit`,
      'section2-2': `an ${tech} holding a wireless temperature meter to check the vent temperature`,
      'section4-1': `an ${tech} holding and checking an AC filter`,
      'section4-2': `an ${tech} cleaning the ducts with a machine`
    },
    {
      'hero-mobile': 'metal air ducts',
      'section2-1': `a male ${tech} with a tool bag smiling at the camera`,
      'section2-2': `a male ${tech} measuring the temperature with a device`,
      'section4-1': 'metal air ducts attached to the ceiling of a building',
      'section4-2': 'a white AC unit outside a building'
    },
    {
      'hero-mobile': 'a family outside their house smiling at the camera with a new AC unit next to them',
      'section2-1': `a male ${tech} checking a mini-split AC unit`,
      'section2-2': '2 AC units outside a house on concrete slabs next to each other',
      'section4-1': `a male ${tech} checking furnace wiring`,
      'section4-2': 'the inside of a very dirty AC duct'
    },
    {
      'hero-mobile': 'an orange cat lying on the carpet next to an AC vent',
      'section2-1': 'a hand holding a thermostat showing 72 degrees in cooling mode',
      'section2-2': 'a mini-split AC unit mounted on a wall',
      'section4-1': `a male ${tech} using a current meter on a furnace unit`,
      'section4-2': `a male ${tech} on a roof checking an AC unit`
    },
    {
      'hero-mobile': 'a brand new AC unit outside on a concrete slab',
      'section2-1': 'a mini-split AC unit and a traditional AC unit side by side',
      'section2-2': `a male ${tech} using a screwdriver to open an AC unit`,
      'section4-1': 'a mini-split AC unit mounted on a wall with the thermostat below it',
      'section4-2': `a male ${tech} cleaning the coils of an old AC unit`
    },
    {
      'hero-mobile': `a male ${tech} using a screwdriver to open a mini-split unit and smiling at the camera`,
      'section2-1': `a male ${tech} giving a thumbs-up to the camera`,
      'section2-2': `an ${tech} cleaning the coils of an AC unit`,
      'section4-1': 'a stream of cool air coming out of a vent',
      'section4-2': 'a family on a couch enjoying the cool air from a mini-split AC unit'
    },
    {
      'hero-mobile': `an ${tech} on a front porch smiling at the camera with an AC unit next to him`,
      'section2-1': 'a family cuddling on a couch next to their furnace',
      'section2-2': 'the inside of a dirty AC duct next to the inside of a clean AC duct',
      'section4-1': `3 ${tech}s outside a house smiling at the camera`,
      'section4-2': 'a fog meter device in the living room of a house'
    },
    {
      'hero-mobile': 'traditional AC ducts installed in the attic of a house',
      'section2-1': 'AC tools on the tailgate of a truck',
      'section2-2': `an ${tech} with a screwdriver checking the wiring of a furnace`,
      'section4-1': `2 ${tech}s smiling at the camera`,
      'section4-2': `an ${tech} fixing a mini-split AC unit`
    }
  ];
};