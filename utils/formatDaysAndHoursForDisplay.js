function formatTime(timeStr) {
    if (!timeStr) return '';
    const [hour, minute] = timeStr.split(':').map(Number);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`;
  }
  
  function getHoursDaysText(is24Hours, hours) {
    if (is24Hours === 'on') return 'All Week';
  
    const openDays = Object.entries(hours || {})
      .filter(([_, val]) => val.open && val.close)
      .map(([day]) => capitalize(day));
  
    if (openDays.length === 7) return 'Monday to Sunday';
    if (openDays.length === 5 && openDays.includes('Monday') && openDays.includes('Friday')) return 'Monday to Friday';
  
    return openDays.join(', ');
  }
  
  function getHoursTimeText(is24Hours, hours) {
    if (is24Hours === 'on') return 'Open 24 Hours';
  
    const times = Object.values(hours || {}).filter(val => val.open && val.close);
    const unique = new Set(times.map(val => `${val.open}-${val.close}`));
  
    if (unique.size === 1) {
      const [val] = times;
      return `${formatTime(val.open)} – ${formatTime(val.close)}`;
    }
  
    return 'Varies by Day';
  }
  
  function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  
  module.exports = {
    getHoursDaysText,
    getHoursTimeText
  };
  