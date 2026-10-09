// utils/formatDaysAndHoursForDisplay.js
//
// Turns the stored 24-hour times into the words that appear on the site.
//
// LOADED TWICE ON PURPOSE. Node requires it to render the generated pages and
// the WordPress theme; the browser loads it as a plain <script> so the form
// can show each day back to the person typing it. The alternative — a second
// copy of formatTime() under public/js — is the mistake this file is shaped to
// avoid: the preview would say one thing, the published page another, and
// nothing would fail.
//
//   node test-hours.js

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HoursFormat = api;
}(typeof window !== 'undefined' ? window : null, function () {

  const ORDER = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const SHORT = { monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu', friday:'Fri', saturday:'Sat', sunday:'Sun' };
  const LONG  = { monday:'Monday', tuesday:'Tuesday', wednesday:'Wednesday', thursday:'Thursday',
                  friday:'Friday', saturday:'Saturday', sunday:'Sunday' };

  const truthy = v => v === true || v === 'true' || v === 'on' || v === '1';

  /**
   * "21:00" -> "9:00 PM", "00:00" -> "12:00 AM", "12:00" -> "12:00 PM".
   *
   * The input is always the browser's canonical HH:MM whatever clock the
   * person sees while typing: an <input type="time"> shows an AM/PM spinner or
   * a 24-hour box according to the computer's locale, and yields HH:MM either
   * way. So this is the single place the site's 12-hour wording is decided.
   */
  function formatTime(hhmm = '') {
    /* MATCHED, NOT COERCED. Number('') is 0, so splitting an empty string and
     * calling Number on it yielded hour zero — and an empty time box rendered
     * on the published page as "12:00 AM". The caller's own `if (!open)` guard
     * never fired, because by then it was holding that string. */
    const raw = String(hhmm == null ? '' : hhmm).trim();
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return '';

    const parts = raw.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || h < 0 || h > 23) return '';
    if (!Number.isFinite(m) || m < 0 || m > 59) return '';
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = ((h + 11) % 12) + 1;
    return `${hour12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${suffix}`;
  }

  /** True when a day's closing time lands on the following morning. */
  function isOvernight(open, close) {
    return Boolean(open && close && String(close) < String(open));
  }

  /**
   * One day, written the way the site writes it.
   *
   * `long` names the day in full, for the form's own preview, where "Monday"
   * reads better beside the row it belongs to than "Mon".
   */
  function describeDay(dayKey, day = {}, opts = {}) {
    const name = (opts.long ? LONG : SHORT)[dayKey] || dayKey;
    if (truthy(day.closed)) return `${name}: Closed`;

    const open = formatTime(day.open);
    const close = formatTime(day.close);
    if (!open || !close) return `${name}: —`;

    // Said out loud, because "5:00 PM – 1:00 AM" on its own reads like a typo,
    // and a real typo reads like overnight trading. The form shows this line
    // as the person types, which is where the difference gets noticed.
    const tail = isOvernight(day.open, day.close) ? ' (next day)' : '';
    return `${name}: ${open} – ${close}${tail}`;
  }

  // Line 1: quick summary.
  function getHoursDaysText(is24Hours, hours) {
    if (truthy(is24Hours)) return 'Open 24 Hours';
    const closed = ORDER.filter(d => truthy(hours && hours[d] && hours[d].closed)).map(d => SHORT[d]);
    if (closed.length === 0) return 'All Week';
    if (closed.length === 7) return 'Closed All Week';
    // This read "Edwin: Sat, Sun" until 8 October — a note to self left inside
    // a return value. Nothing calls this function, which is the only reason it
    // never reached a published site.
    return `Closed: ${closed.join(', ')}`;
  }

  // Line 2: detailed schedule (HTML).
  function getHoursTimeText(is24Hours, hours) {
    if (truthy(is24Hours)) return 'Open 24 Hours';
    return ORDER.map(d => describeDay(d, (hours && hours[d]) || {})).join('<br>');
  }

  return {
    getHoursDaysText, getHoursTimeText,
    formatTime, describeDay, isOvernight,
    ORDER, SHORT, LONG,
  };
}));
