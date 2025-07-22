function normalizeDomain(input) {
    if (!input) return '';
  
    // Remove http:// or https://
    let domain = input.replace(/^https?:\/\//, '');
  
    // Remove any trailing slashes
    domain = domain.replace(/\/+$/, '');
  
    // Add "www." if not present
    if (!domain.startsWith('www.')) {
      domain = 'www.' + domain;
    }
  
    return domain;
  }

  module.exports = { normalizeDomain };