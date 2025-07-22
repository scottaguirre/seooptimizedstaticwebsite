const { formatCityState } = require('./formatCityState');


function buildAltAttribute(globalValues, desc){
    if(desc){
        return `${desc} from ${globalValues.businessName} in ${formatCityState(globalValues.location)}`;
    }else{
        return `image of ${globalValues.businessName} in ${formatCityState(globalValues.location)}`;
    }
   
}

module.exports = { buildAltAttribute };
