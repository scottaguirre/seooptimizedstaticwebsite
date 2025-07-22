
const { normalizeText } = require('./normalizeText.js');
const { smartTitleCase } = require('./smartTitleCase.js');
const { slugify } = require('./slugify.js');

const buildNavMenu = function (pages, basePath, locationSlug, filename){
    // ===  NavMenu =====
    let linkOutsideNavMenu = "";
    let firstPageName = "";
    let firstPageNameActive = "";

    const navMenu = Object.entries(pages).map(([i, p]) => {
        const pageSlug = slugify(p.filename);
        const isActive = (pageSlug === filename) ? 'active' : '';

        if(Object.entries(pages).length > 1){ // If 2 pages or more are entered

            if(i === "0"){  
                // Extract the first page in the 1st iteration and navMenu starting the 2ndo interaction

            linkOutsideNavMenu = `${basePath}${pageSlug}-${normalizeText(locationSlug)}.html`;
            firstPageName = smartTitleCase(p.filename);
            firstPageNameActive = isActive;

            } else {
                    // navMenu is built starting from the 2nd iteration
                return `<li class="nav-item">
                            <a class="nav-link dropdown-item ${isActive}" href="${basePath}${pageSlug}-${normalizeText(locationSlug)}.html">
                            ${smartTitleCase(p.filename)}
                            </a>
                        </li>`;
            }           

        } else {  // If only 1 page is entered navMenu = ""

            linkOutsideNavMenu = `${basePath}${pageSlug}-${normalizeText(locationSlug)}.html`;
            firstPageName = smartTitleCase(p.filename);
            firstPageNameActive = isActive;
            return  "";
        }

    }).join('');

    return {
                linkOutsideNavMenu,
                firstPageName,
                firstPageNameActive,
                navMenu
            };

};

module.exports = { buildNavMenu };

