function slugify(str) {
    return str
      .toLowerCase()
      .trim()
      .replace(/,/g, '')         // remove commas
      .replace(/\s+/g, '-')      // replace spaces with dashes
      .replace(/[^a-z0-9\-]/g, '') // remove non-alphanumeric (optional)
      .replace(/-+/g, '-')       // collapse multiple dashes
      .replace(/^-|-$/g, '');    // trim starting/trailing dashes
  }
  

  module.exports = { slugify };