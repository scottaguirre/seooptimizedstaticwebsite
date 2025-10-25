
const { slugify } = require('./slugify.js');
const { formatCityForSchema } = require('./formatCityForSchema');

// Helper: normalize pages array (your "pages" can be object-like)
function toArray(pages) {
    if (!pages) return [];
    return Array.isArray(pages) ? pages : Object.values(pages);
}


const buildNavMenu  = function (template, globalValues, pages, basePath, mainLocationSlug, filename, context){
    // ===  Services Nav Menu =====
    let containerMenu;
    let FIRST_PAGE_NAME = '';
    let FIRST_PAGE_NAME_ACTIVE = '';
    let LINK_OUTSIDE_NAV_MENU = '';
    const pagesArr = toArray(pages);

    if(pagesArr.length === 1 ){
        const only = pagesArr[0];
        const onlyOnePageSlug = slugify(only.filename || '');
        LINK_OUTSIDE_NAV_MENU = `${basePath}${onlyOnePageSlug}-${mainLocationSlug}.html`;
        FIRST_PAGE_NAME = only.filename.toUpperCase();
        const isActiveService = context === 'services' && slugify(filename) === onlyOnePageSlug;
        FIRST_PAGE_NAME_ACTIVE = isActiveService ? 'active' : '';
        let aboutusActive = "";
        if(context === "aboutus") {
            aboutusActive  = 'active';
        }


        containerMenu = `<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">
                            <ul class="navbar-nav ms-auto">
                                <li class="nav-item"><a class="nav-link ${aboutusActive}" href="/dist/">ABOUT US</a></li>
                                <li class="nav-item"><a class="nav-link ${FIRST_PAGE_NAME_ACTIVE}" href="${LINK_OUTSIDE_NAV_MENU}">${FIRST_PAGE_NAME}</a></li>
                                `;

    } else if(pagesArr.length > 1) {
        
        const only = pagesArr[0];
        const onlyOnePageSlug = slugify(only.filename || '');
        LINK_OUTSIDE_NAV_MENU = `${basePath}${onlyOnePageSlug}-${mainLocationSlug}.html`;
        FIRST_PAGE_NAME = only.filename.toUpperCase();
        const isActiveService = context === 'services' && slugify(filename) === onlyOnePageSlug;
        FIRST_PAGE_NAME_ACTIVE = isActiveService ? 'active' : '';
        let aboutusActive = "";
        if(context === "aboutus") {
            aboutusActive  = 'active';
        }

        containerMenu = `<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">
                            <ul class="navbar-nav ms-auto">
                                <li class="nav-item"><a class="nav-link ${aboutusActive}" href="/dist/">ABOUT US</a></li>
                                <li class="nav-item"><a class="nav-link ${FIRST_PAGE_NAME_ACTIVE}" href="${LINK_OUTSIDE_NAV_MENU}">${FIRST_PAGE_NAME}</a></li>
                                <li class="nav-item dropdown services-dropdown-option">
                                    <a class="nav-link dropdown-toggle" href="#" id="servicesDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                                        SERVICES
                                    </a>          
                                    <ul class="dropdown-menu">
                                `;


        let servicesListLinks = pagesArr.map( (page, i) => {
            if( i > 0 ){
                const href = `${basePath}${slugify(page.filename)}-${mainLocationSlug}.html`;
                const isActive = context === 'services' && slugify(filename) === slugify(page.filename);
                const label = page.filename;

                return `
                        <li class="nav-item">
                            <a class="dropdown-item nav-link ${isActive ? 'active' : ''}" href="${href}">
                                ${label.toUpperCase()}
                            </a>
                        </li>
                    `;
            }   
        }).join('').trim();

        containerMenu = `${containerMenu} ${servicesListLinks} </ul> </li>`;

    }
    

    // =======  LOCATION PAGES

    if(globalValues.locationPages.length > 0 ){ // If 1 location page or more are entered
      
        
        let completeListLocationsNav = `<li class="nav-item dropdown locations-dropdown-option">
                                            <a class="nav-link dropdown-toggle" href="#" id="locationsDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                                                LOCATIONS
                                            </a>          
                                            <ul class="dropdown-menu">`;

        const locationsListMenu = globalValues.locationPages.map(pageLocation => {
        const pageSlug = slugify(pageLocation.display);
        const href = `${basePath}location-${pageSlug}.html`;
        const cityLabel = formatCityForSchema(pageLocation.display);
        const isActive = context === 'locations' && pageSlug === slugify(filename);
        
        
        return `<li class="nav-item">
                    <a class="nav-link dropdown-item ${isActive ? 'active' : ''}" href="${href}">
                    ${cityLabel.toUpperCase()}
                    </a>
                </li>`; 

        }).join('');

        containerMenu = ` ${containerMenu} ${completeListLocationsNav} ${locationsListMenu} </ul> </li> </ul> </div>`;
        

    } else {

        containerMenu = `${containerMenu} </ul> </div>`;       

    }
    
    template = template.replace(/<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">[\s\S]*?<\/div>\s*/i, containerMenu);
    
    return template;
};

module.exports = { buildNavMenu };

