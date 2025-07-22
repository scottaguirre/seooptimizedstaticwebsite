function formatPhoneForHref(phone = '') {
    return 'tel:+1' + phone.replace(/[^\d]/g, ''); // Remove all non-digit characters
  }
  
  module.exports = { formatPhoneForHref };