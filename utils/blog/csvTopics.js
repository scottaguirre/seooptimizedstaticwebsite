// utils/blog/csvTopics.js
//
// A spreadsheet of topics -> the lines the topics box already understands.
//
// WHY THE FILE IS READ IN THE BROWSER AND NOT UPLOADED.
//
// The plugin takes a real upload, because WordPress hands it one. This app
// cannot do the same cheaply: csrfProtect runs app-wide BEFORE any route and
// reads the token out of req.body, which for multipart/form-data nothing has
// parsed yet — its own comment says so. A plain <form enctype="multipart">
// with a hidden _csrf is therefore REFUSED, and making it work means posting
// by script with an x-csrf-token header, a multer instance with its own
// limits, and a local error handler because server.js answers every
// multipart request with JSON.
//
// All of that to put text into a textarea the person can already paste into.
// So the browser opens the file, this turns it into lines, and the lines go
// in the box. Nothing is uploaded, nothing unparsed reaches the server, and
// — the part that matters most on this screen — YOU SEE WHAT LANDED BEFORE
// YOU PRESS PLAN. That is the rule the suggestion buttons already follow.
//
// THE SAME FUNCTION RUNS IN BOTH PLACES, AND THAT IS THE WHOLE TRICK.
// csvToTopicLines is written here, tested here, and the PAGE IS GIVEN ITS
// SOURCE — see browserSource(). A copy hand-written into a <script> tag
// would be a second parser nothing tests, which is how the two would drift
// apart and only one of them would be right.
//
// IT MUST THEREFORE BE SELF-CONTAINED. No require, no module-scope constant,
// no helper from outside its own body: in the browser there is no module
// around it, and a reference to one is a ReferenceError at the moment
// somebody picks a file. test-csv-topics.js enforces this by evaluating the
// emitted source in an empty sandbox and comparing it against this copy — so
// an instrumented or transpiled build fails the suite rather than the
// customer.
//
// NO LIMIT ON TOPICS KEPT, DELIBERATELY. createCampaign refuses more than 52
// in a sentence that says so. Repeating the number here would be a second
// place for it to be wrong, and the person would be told off by a browser
// before the server had looked at anything. The row ceiling below is not
// that: it is a guard against a file that is not a topic list at all.

'use strict';

/**
 * CSV text -> `topic | search phrase | link phrase` lines.
 *
 * THREE COLUMNS, IN THE ORDER THE PLUGIN USES: the topic, the search phrase
 * it should win, and how other posts refer to it mid-sentence. The second
 * and third are optional; parseTopics falls back to the topic for a missing
 * phrase exactly as it does for a typed line.
 *
 * A REAL CSV READER, NOT A SPLIT ON COMMAS. Topics contain commas —
 * "Water heater repair, costs, and timing" is one topic, not three — and
 * every spreadsheet quotes such a field. Splitting naively would shred them
 * silently, which is the reason pasting a CSV into the box is not offered as
 * an alternative to this.
 *
 * @param  {string} text
 * @returns {string[]}
 */
function csvToTopicLines(text) {
  /* INSIDE THE BODY because this function is also emitted on its own into a
   * page. A constant declared outside it would be undefined there. */
  var MAX_ROWS = 2000;

  /* A UTF-8 byte order mark, which Excel writes and nothing shows. Left in
   * place it rides along inside the first topic, so the first post of a
   * campaign gets a title and a slug subtly unlike every other one and
   * nobody can see why. The plugin learned this the same way. */
  var s = String(null == text ? '' : text).replace(/^\uFEFF/, '');

  var rows = [];
  var row = [];
  var cell = '';
  var quoted = false;

  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);

    if (quoted) {
      /* "" INSIDE A QUOTED FIELD IS ONE QUOTE. Every spreadsheet writes a
       * literal quote this way, and reading it as the end of the field turns
       * the rest of the row into columns nobody asked for. */
      if ('"' === ch) {
        if ('"' === s.charAt(i + 1)) { cell += '"'; i++; }
        else quoted = false;
      } else {
        cell += ch;          // a newline in here belongs to the field
      }
      continue;
    }

    if ('"' === ch && '' === cell) { quoted = true; continue; }
    if (',' === ch) { row.push(cell); cell = ''; continue; }

    if ('\n' === ch || '\r' === ch) {
      if ('\r' === ch && '\n' === s.charAt(i + 1)) i++;   // CRLF is one break
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= MAX_ROWS) break;
      continue;
    }

    cell += ch;
  }

  /* THE LAST ROW, WHEN THE FILE DOES NOT END IN A NEWLINE. Plenty do not,
   * and dropping the final topic of every such file is the kind of bug that
   * gets blamed on the spreadsheet. */
  if ('' !== cell || row.length) { row.push(cell); rows.push(row); }

  /* THE PIPE IS THE BOX'S OWN SEPARATOR, so a cell containing one would
   * invent a column on the way back in. Replaced rather than dropped: a
   * topic with a pipe in it is still a topic, and the person can see what
   * it became. */
  function clean(value) {
    return String(null == value ? '' : value)
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var lines = [];

  /* Object.create(null) RATHER THAN {}. A topic called "__proto__" or
   * "constructor" does not get its own property on a plain object, so it
   * would never be seen as a duplicate — and, worse, `seen[key]` would read
   * back truthy for "constructor" on the FIRST sighting and silently drop
   * it. A null-prototype object has no such names. */
  var seen = Object.create(null);

  for (var r = 0; r < rows.length; r++) {
    var topic = clean(rows[r][0]);

    if ('' === topic) continue;          // a blank line, or a trailing newline

    /* A HEADER ROW, AND ONLY WHEN IT IS UNMISTAKABLE. People export from a
     * spreadsheet with the column names on top, and "topic" as a line of its
     * own would otherwise become the first article of the campaign. The test
     * is the bare word and nothing else: a real topic is a sentence, and
     * anything longer is kept. And if this ever guesses wrong it is visible
     * in the box before anything is planned, which is the whole argument for
     * reading the file here. */
    if (0 === r && ('topic' === topic.toLowerCase() || 'topics' === topic.toLowerCase())) {
      continue;
    }

    var key = topic.toLowerCase();

    /* DUPLICATES WITHIN THE FILE ARE DROPPED, case-insensitively. Two rows
     * with the same topic are a copy-paste accident, and planning would give
     * them near-identical slugs and then refuse the campaign for chasing the
     * same search — a confusing way to find out you pasted twice. */
    if (seen[key]) continue;
    seen[key] = true;

    var query = clean(rows[r][1]);
    var phrase = clean(rows[r][2]);

    /* TRAILING EMPTIES ARE NOT WRITTEN. "Topic |  | " round-trips through
     * parseTopics to the same thing as "Topic", but it reads like a mistake
     * and invites somebody to fill in a box that did not need filling. */
    if (phrase) lines.push(topic + ' | ' + query + ' | ' + phrase);
    else if (query) lines.push(topic + ' | ' + query);
    else lines.push(topic);
  }

  return lines;
}

/**
 * The parser's own source, for inlining into a page.
 *
 * Function.prototype.toString, rather than a string literal holding a second
 * copy. The copy is the thing worth avoiding: two parsers, one tested, and
 * no way to notice the day they stop agreeing.
 */
function browserSource() {
  return csvToTopicLines.toString();
}

module.exports = { csvToTopicLines, browserSource };
