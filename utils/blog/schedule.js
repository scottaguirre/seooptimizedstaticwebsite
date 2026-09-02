// utils/blog/schedule.js
//
// When each post publishes.
//
// WHY THIS IS NOT ONE LINE OF ARITHMETIC
//
// The obvious version is start + i * days * 86400000, which is what
// planCampaign.js does today. It is right about the date and says nothing
// about the time, which is how the old theme-based automation ended up
// publishing at whatever hour cron happened to fire — usually the small
// hours, which is exactly when a real business does not post.
//
// Adding a time of day makes daylight saving matter. A campaign starting in
// March at 09:00 America/Chicago and running to November crosses two DST
// boundaries. Add 7 * 86400000 each time and the posts drift to 08:00 after
// the autumn change: the arithmetic is correct, the wall clock is not, and
// nobody notices until a customer asks why their posts moved.
//
// So the cadence is counted in CALENDAR DAYS in the site's own timezone, and
// the wall-clock time is re-applied at each step. 09:00 stays 09:00.
//
// Pure, and no dependency: Intl carries the timezone database, so there is no
// need for moment-timezone or date-fns-tz.

/**
 * How far the named zone is from UTC at a given instant, in milliseconds.
 *
 * Read out of Intl rather than looked up in a table, so the answer is right
 * for that specific instant — which is the whole point, since the offset
 * changes twice a year.
 */
function zoneOffsetMs(utcMs, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  
    const parts = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  
    // Hour comes back as '24' at midnight in some ICU versions.
    const asIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
  
    return asIfUtc - utcMs;
  }
  
  /**
   * A wall-clock time in a zone -> the UTC instant it refers to.
   *
   * Done in two passes. The first guess uses the offset in force at the
   * approximate instant; near a DST boundary that offset can be the wrong one,
   * so the offset is read again at the corrected instant and applied if it
   * differs. Without the second pass, a post scheduled for the morning of a
   * clock change lands an hour out.
   *
   * The pathological cases are handled the way a person would expect:
   *   - a time that does not exist (spring forward) resolves to the instant
   *     just after the jump
   *   - a time that happens twice (autumn back) resolves to the first
   */
  function zonedWallTimeToUtc({ year, month, day, hour, minute }, timeZone) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  
    const firstOffset = zoneOffsetMs(guess, timeZone);
    let instant = guess - firstOffset;
  
    const secondOffset = zoneOffsetMs(instant, timeZone);
    if (secondOffset !== firstOffset) {
      instant = guess - secondOffset;
    }
  
    return new Date(instant);
  }
  
  /** The calendar date in a zone at a given instant. */
  function zonedDateParts(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  
    const parts = {};
    for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
    };
  }
  
  /** 'HH:MM' -> { hour, minute }, falling back to 09:00 on anything malformed. */
  function parseTimeOfDay(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m) return { hour: 9, minute: 0 };
  
    const hour = Math.min(23, Math.max(0, Number(m[1])));
    const minute = Math.min(59, Math.max(0, Number(m[2])));
    return { hour, minute };
  }
  
  /**
   * Is this a timezone Intl actually knows?
   *
   * A bad value must not reach Intl unguarded: it throws a RangeError, and a
   * campaign would fail to plan because a WordPress install reported a
   * timezone string we did not expect. UTC is the safe fallback — an hour out
   * is a nuisance, a crash is a broken feature.
   */
  function isValidTimeZone(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch (_) {
      return false;
    }
  }
  
  /**
   * Publish instants for a campaign.
   *
   * @param {object} opts
   * @param {number} opts.count        how many posts
   * @param {number} opts.everyDays    calendar days between them
   * @param {string} opts.publishTime  'HH:MM' local
   * @param {string} opts.timezone     IANA zone, e.g. 'America/Chicago'
   * @param {Date}   [opts.startAt]    first post; defaults to the next occurrence
   * @returns {Date[]} UTC instants, ascending
   */
  function publishDates({ count, everyDays = 7, publishTime = '09:00', timezone = 'UTC', startAt }) {
    const zone = isValidTimeZone(timezone) ? timezone : 'UTC';
    const { hour, minute } = parseTimeOfDay(publishTime);
    const gap = Math.max(1, Math.floor(Number(everyDays) || 7));
  
    const anchor = startAt instanceof Date && !Number.isNaN(startAt.getTime())
      ? startAt
      : new Date();
  
    const base = zonedDateParts(anchor, zone);
  
    const out = [];
    for (let i = 0; i < count; i++) {
      // Date.UTC normalises overflow, so day + 21 rolls into the next month
      // without any calendar arithmetic here. Read back as Y/M/D and then
      // re-anchored to the wall clock, which is what keeps 09:00 at 09:00.
      const stepped = new Date(Date.UTC(base.year, base.month - 1, base.day + i * gap));
  
      out.push(zonedWallTimeToUtc({
        year: stepped.getUTCFullYear(),
        month: stepped.getUTCMonth() + 1,
        day: stepped.getUTCDate(),
        hour,
        minute,
      }, zone));
    }
  
    // If the first slot's time has already passed today, the whole run shifts
    // forward by one gap. Otherwise a campaign created at 2pm for 9am posting
    // would have its first post immediately overdue, and the scheduler would
    // fire it within the minute — which reads as a bug to the customer.
    if (out.length && out[0].getTime() <= Date.now()) {
      return publishDates({
        count,
        everyDays: gap,
        publishTime,
        timezone: zone,
        startAt: new Date(Date.UTC(base.year, base.month - 1, base.day + gap)),
      });
    }
  
    return out;
  }
  
  module.exports = {
    publishDates,
    zonedWallTimeToUtc,
    zonedDateParts,
    zoneOffsetMs,
    parseTimeOfDay,
    isValidTimeZone,
  };