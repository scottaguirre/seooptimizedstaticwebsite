const { getCoordinatesFromAddress } = require('./getCoordinatesFromAddress');

async function googleMap(address){
   
    const zoom = 15;
    let mapEmbedSrc = '';

    if (address){
        mapEmbedSrc = `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed`;
        return mapEmbedSrc;
    }
}

module.exports = { googleMap };
