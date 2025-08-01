const stateAbbreviations = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming"
  };

  const getFullStateName = function (location) {
    if (!location) {
      console.warn('⚠️ getFullStateName: Missing page or location.');
      return '';
    }
  
    // Trim and grab the last 2 letters
    const trimmed = location.trim();
    const lastTwo = trimmed.slice(-2).toUpperCase(); // e.g., "TX"
  
    const fullStateName = stateAbbreviations[lastTwo];
  
    if (!fullStateName) {
      console.warn(`⚠️ getFullStateName: Unknown state abbreviation "${lastTwo}" in "${location}"`);
      return '';
    }
  
    return fullStateName;
  };
  

  module.exports = { getFullStateName };
  