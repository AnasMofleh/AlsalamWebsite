/**
 * Google Apps Script — Bönetider (Prayer Times) Proxy
 *
 * Fetches the official monthly prayer-times table for Helsingborg from
 * https://www.islamiskaforbundet.se/bonetider/ (IFS), passes the site's
 * anti-bot proof-of-work challenge when needed, persists the parsed month
 * server-side and serves it as JSON to the homepage widget (js/bonetider.js).
 *
 * Deploy as a web app:
 *   1. Deploy > New deployment > Web app
 *   2. Execute as: Me
 *   3. Who has access: Anyone
 *   4. Copy the deployment URL and replace BT_API_URL
 *      in js/bonetider.js
 *
 * Usage:
 *   /exec                  -> { ok, city, month, year, days, next, updated_at }
 *   /exec?city=Landskrona  -> other city ("<name>, SE" appended automatically;
 *                             the widget is configured in js/bonetider.js)
 *   /exec?force=1          -> bypass storage and re-fetch from source (testing)
 *   On failure             -> { ok: false, error }
 *
 * Script properties (created automatically):
 *   BT_MONTHS        JSON payload of the stored month (persisted server-side)
 *   BT_COOKIE        persisted sc_clearance WAF cookie ("sc_clearance=...")
 *   BT_COOKIE_TS     epoch ms when the cookie was stored
 * Optional, set manually once a year (YYYY-MM-DD):
 *   RAMADAN_START    first day of Ramadan
 *   RAMADAN_END      last day of Ramadan
 * Inside that window the source's special month table "13" is used.
 */

var CITY = 'Helsingborg, SE';
var TIMEZONE = 'Europe/Stockholm';
var SOURCE_URL = 'https://www.islamiskaforbundet.se/wp-content/plugins/bonetider/Bonetider_Widget.php';
var VERIFY_URL = 'https://www.islamiskaforbundet.se/.sc-verify/';
var CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

var KEY_MONTHS = 'BT_MONTHS';
var KEY_COOKIE = 'BT_COOKIE';
var KEY_COOKIE_TS = 'BT_COOKIE_TS';
var KEY_RAMADAN_START = 'RAMADAN_START';
var KEY_RAMADAN_END = 'RAMADAN_END';

var CACHE_KEY = 'bt_v1';
var CACHE_TTL_SECONDS = 600;                // hot cache on top of Properties
var FRESH_MAX_DAYS = 7;                     // re-fetch from source at most weekly
var COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // clearance cookie reuse window
var POW_MAX_ITERATIONS = 2000000;           // safety cap — difficulty can rise

function doGet(e) {
  try {
    var force = !!(e && e.parameter && e.parameter.force === '1');
    var city = normalizeCity(e && e.parameter && e.parameter.city);
    var today = todayInStockholm();

    var payload = null;
    if (!force) {
      payload = loadFromCache(city);
      if (payload && !matchesToday(payload, today)) payload = null;
      if (!payload) payload = loadFromProps(today, city);
    }

    if (!payload || !isFresh(payload)) {
      payload = refreshMonths(today, city);
      storeMonths(payload);
    }

    cache().put(cacheKeyFor(city), JSON.stringify(payload), CACHE_TTL_SECONDS);
    return jsonResponse(payload);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

/* --- Time and month selection ---------------------------------------- */

function todayInStockholm() {
  var dateStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return {
    year: parseInt(dateStr.slice(0, 4), 10),
    month: parseInt(dateStr.slice(5, 7), 10),
    dateStr: dateStr
  };
}

/** Normalize the requested city ("<name>, SE" format, safe characters only).
 *  Defaults to Helsingborg — the location is configurable per request, so
 *  the widget can move to another city without redeploying. */
function normalizeCity(raw) {
  var city = raw ? String(raw).trim() : '';
  if (!city) return CITY;
  city = city.replace(/[^A-Za-z0-9ÅÄÖåäöÉéÜüÀàÈè\s,.-]/g, '');
  if (!/, SE$/i.test(city)) {
    city = city.split(',')[0].trim();
    if (city) city += ', SE';
  }
  return city || CITY;
}

function cityDisplayName(city) {
  return city.split(',')[0].trim();
}

function cacheKeyFor(city) {
  return CACHE_KEY + '_' + cityDisplayName(city).toLowerCase();
}

/** Source month selector: the calendar month, or "13" inside the configured
 *  Ramadan window (RAMADAN_START/RAMADAN_END script properties). */
function monthSpecForDate(dateStr) {
  var start = props().getProperty(KEY_RAMADAN_START);
  var end = props().getProperty(KEY_RAMADAN_END);
  if (start && end && dateStr >= start && dateStr <= end) return '13';
  return String(parseInt(dateStr.slice(5, 7), 10));
}

function matchesToday(payload, today) {
  return payload
    && String(payload.month) === monthSpecForDate(today.dateStr)
    && payload.year === today.year;
}

function isFresh(payload) {
  if (!payload || !payload.updated_at) return false;
  // updated_at is stored as epoch ms; old ISO strings parse to NaN -> refetch.
  var ageMs = Date.now() - Number(payload.updated_at);
  return ageMs < FRESH_MAX_DAYS * 24 * 60 * 60 * 1000;
}

function nextMonthOf(today) {
  var m = today.month + 1;
  var y = today.year;
  if (m > 12) { m = 1; y += 1; }
  return { month: m, year: y };
}

/* --- Storage ---------------------------------------------------------- */

function loadFromCache(city) {
  try {
    var raw = cache().get(cacheKeyFor(city));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function loadFromProps(today, city) {
  try {
    var raw = props().getProperty(KEY_MONTHS);
    if (!raw) return null;
    var stored = JSON.parse(raw);
    if (!matchesToday(stored, today)) return null;
    if (stored.city !== cityDisplayName(city)) return null;
    if (!stored.days || !stored.days.length) return null;
    return stored;
  } catch (e) {
    return null;
  }
}

function storeMonths(payload) {
  props().setProperty(KEY_MONTHS, JSON.stringify(payload));
}

function readCookie() {
  try {
    var ts = Number(props().getProperty(KEY_COOKIE_TS) || 0);
    if (Date.now() - ts > COOKIE_MAX_AGE_MS) return '';
    return props().getProperty(KEY_COOKIE) || '';
  } catch (e) {
    return '';
  }
}

function storeCookie(cookieValue) {
  props().setProperty(KEY_COOKIE, 'sc_clearance=' + cookieValue);
  props().setProperty(KEY_COOKIE_TS, String(Date.now()));
}

/* --- Source fetching + WAF challenge ---------------------------------- */

/** Fetch the current month table + next month's table from the source.
 *  "next" is always included so the client can target tomorrow's Fajr
 *  after Isha at month end. */
function refreshMonths(today, city) {
  var curSpec = monthSpecForDate(today.dateStr);
  var curDays = parseMonthTable(fetchMonthTable(curSpec, city));
  if (!curDays.length) throw new Error('Inga rader i bönetidstabellen för månad ' + curSpec);

  var next = nextMonthOf(today);
  // First day of next month, computed at midday to be timezone-safe.
  var nextDateStr = Utilities.formatDate(
    new Date(next.year, next.month - 1, 2, 12, 0, 0), TIMEZONE, 'yyyy-MM') + '-01';
  var nextSpec = monthSpecForDate(nextDateStr);

  var nextDays;
  if (nextSpec === curSpec) {
    // Ramadan: the special table covers the whole window — reuse it.
    // Verified live: the "Dat" column holds the Gregorian day-of-month and
    // spans two calendar months (e.g. 19..28 then 1..19). TODO before next
    // Ramadan: disambiguate the two months by row position (rows before the
    // day-number reset belong to RAMADAN_START's month) on the client.
    nextDays = curDays;
  } else {
    nextDays = parseMonthTable(fetchMonthTable(nextSpec, city));
  }

  return {
    ok: true,
    city: cityDisplayName(city),
    month: curSpec,
    year: today.year,
    days: curDays,
    next: { month: nextSpec, year: next.year, days: nextDays },
    updated_at: Date.now()
  };
}

/** Fetch one month table, solving the Simply.com proof-of-work challenge
 *  when the request comes back challenged (HTTP 454 "Checking your browser"). */
function fetchMonthTable(monthSpec, city) {
  var params = {
    ifis_bonetider_page_city: city,
    ifis_bonetider_page_month: String(monthSpec)
  };

  var html = postSource(params, readCookie());
  if (isTable(html)) return html;

  var challenge = extractChallenge(html);
  if (!challenge) {
    throw new Error('Bönetider-källan blockerar förfrågan (ingen lösbar utmaning)');
  }

  var nonce = solvePoW(challenge.token, challenge.difficulty);
  var cookie = verifyChallenge(challenge, nonce);
  storeCookie(cookie);

  var retryHtml = postSource(params, 'sc_clearance=' + cookie);
  if (!isTable(retryHtml)) {
    throw new Error('Bönetider-källan blockerar fortfarande efter utmaningen');
  }
  return retryHtml;
}

function postSource(params, cookie) {
  var headers = { 'User-Agent': CHROME_UA };
  if (cookie) headers['Cookie'] = cookie;
  var resp = UrlFetchApp.fetch(SOURCE_URL, {
    method: 'post',
    payload: params,
    headers: headers,
    muteHttpExceptions: true,
    timeout: 20
  });
  return resp.getContentText();
}

function isTable(html) {
  return html && /<table[^>]*>[\s\S]*<tbody[^>]*>/i.test(html);
}

/** Extract the challenge parameters from the WAF page. Captured
 *  independently so the markup order does not matter. */
function extractChallenge(html) {
  var t = html.match(/var\s+T="([0-9a-f]{64})"/i);
  var ts = html.match(/\bTS="(\d+)"/i);
  var d = html.match(/\bD=(\d+)/i);
  if (t && ts && d) {
    return { token: t[1], ts: ts[1], difficulty: parseInt(d[1], 10) };
  }
  return null;
}

/** Find the nonce n where sha256(T + ":" + n) has >= D leading zero bits. */
function solvePoW(token, difficulty) {
  for (var n = 0; n < POW_MAX_ITERATIONS; n++) {
    var digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, token + ':' + n, Utilities.Charset.UTF_8);
    if (leadingZeroBits(digest) >= difficulty) return String(n);
  }
  throw new Error('Bönetider-utmaningen är för svår (D=' + difficulty + ')');
}

function leadingZeroBits(bytes) {
  var bits = 0;
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xFF; // computeDigest returns signed bytes in GAS
    for (var s = 7; s >= 0; s--) {
      if ((b >> s) & 1) return bits;
      bits++;
    }
  }
  return bits;
}

/** POST the solved nonce to /.sc-verify/ and return the clearance cookie. */
function verifyChallenge(challenge, nonce) {
  var resp = UrlFetchApp.fetch(VERIFY_URL, {
    method: 'post',
    payload: { ts: challenge.ts, nonce: nonce, token: challenge.token },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': CHROME_UA,
      'Origin': 'https://www.islamiskaforbundet.se',
      'Referer': 'https://www.islamiskaforbundet.se/bonetider/'
    },
    muteHttpExceptions: true,
    timeout: 20
  });

  try {
    var json = JSON.parse(resp.getContentText());
    if (json.ok && json.cookie) return String(json.cookie);
  } catch (e) { /* fall through to Set-Cookie header */ }

  var setCookie = resp.getHeaders()['Set-Cookie'];
  if (setCookie) {
    var m = String(setCookie).match(/sc_clearance=([^;]+)/i);
    if (m) return m[1];
  }

  throw new Error('WAF-verifieringen avvisades (status ' + resp.getResponseCode() + ')');
}

/* --- Table parsing ----------------------------------------------------- */

/** Parse the monthly table, mapping columns by thead header text (never by
 *  position — the Ramadan table has an extra "Ram" column). Missing columns
 *  are simply omitted from each row. */
function parseMonthTable(html) {
  var theadM = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (!theadM) return [];

  var headers = [];
  var thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi, thm;
  while ((thm = thRe.exec(theadM[1]))) {
    headers.push(thm[1].replace(/<[^>]+>/g, '').trim().toLowerCase());
  }

  var idx = {};
  for (var i = 0; i < headers.length; i++) idx[headers[i]] = i;
  if (idx['dat'] == null) return [];

  var tbodyM = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyM) return [];

  // The source table has UNCLOSED rows (<tr> with no </tr> between rows),
  // so split rows on the next <tr> boundary instead of a closing tag.
  // Keep only chunks that actually contain cells (robust against engines
  // that differ on leading empty chunks in regex splits).
  var splitChunks = tbodyM[1].split(/<tr[^>]*>/i);
  var rowChunks = [];
  for (var s = 0; s < splitChunks.length; s++) {
    if (/<td[^>]*>/i.test(splitChunks[s])) rowChunks.push(splitChunks[s]);
  }

  var days = [];
  for (var r = 0; r < rowChunks.length; r++) {
    var cells = [];
    var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi, tdm;
    while ((tdm = tdRe.exec(rowChunks[r]))) {
      cells.push(tdm[1].replace(/<[^>]+>/g, '').trim());
    }

    var day = parseInt(cells[idx['dat']], 10);
    if (!day) continue;

    var entry = { day: day };
    var names = ['fajr', 'shuruk', 'dhohr', 'asr', 'magrib', 'isha'];
    for (var j = 0; j < names.length; j++) {
      var k = names[j];
      if (idx[k] != null && cells[idx[k]]) entry[k] = cells[idx[k]];
    }
    days.push(entry);
  }
  return days;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function props() {
  return PropertiesService.getScriptProperties();
}

function cache() {
  return CacheService.getScriptCache();
}
