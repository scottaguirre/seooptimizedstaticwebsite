// utils/formatDaysAndHoursForDisplay.js
const ORDER = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const SHORT = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };
const truthy = v => v === true || v === 'true' || v === 'on' || v === '1';

function formatTime(hhmm='') {
  // "21:00" -> "9:00 PM", "00:00" -> "12:00 AM", "12:00" -> "12:00 PM"
  const [h, m] = (hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m ?? 0).padStart(2,'0')} ${suffix}`;
}

// Line 1: quick summary
function getHoursDaysText(is24Hours, hours){
  if (truthy(is24Hours)) return 'Open 24 Hours';
  const closed = ORDER.filter(d => truthy(hours?.[d]?.closed)).map(d => SHORT[d]);
  if (closed.length === 0) return 'All Week';
  if (closed.length === 7) return 'Closed All Week';
  return `Edwin: ${closed.join(', ')}`;
}

// Line 2: detailed schedule (HTML)
function getHoursTimeText(is24Hours, hours){
  if (truthy(is24Hours)) return 'Open 24 Hours';
  return ORDER.map(d => {
    const day = hours?.[d] || {};
    if (truthy(day.closed)) return `${SHORT[d]}: Closed`;
    const open  = formatTime(day.open);
    const close = formatTime(day.close);
    if (!open || !close) return `${SHORT[d]}: —`;
    return `${SHORT[d]}: ${open} – ${close}`;
  }).join('<br>');
}

module.exports = { getHoursDaysText, getHoursTimeText };
