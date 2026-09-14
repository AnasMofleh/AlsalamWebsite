/**
 * Google Apps Script — FIFS Membership Proxy
 *
 * Deploy as a web app:
 *   1. Deploy > New deployment > Web app
 *   2. Execute as: Me
 *   3. Who has access: Anyone
 *   4. Copy the deployment URL and replace YOUR_DEPLOYMENT_ID
 *      in membership-check/index.html and donations/index.html
 *
 * Usage: /exec?pnr=YYYYMMDD-XXXX
 * Returns: { isMember: boolean, memberSince: string, memberSinceFormatted: string }
 *
 * FIFS API (https://medlem.fifs.se/api/docs):
 *   POST https://medlem.fifs.se/api/validate-member
 *   Header: X-API-Key: <token>
 *   Body:   { personnummer: "YYYYMMDD-XXXX" }
 *   Response: { status, active, myorganization, memberSince? }
 *
 * API key: set the Script Property FIFS_API_KEY (Project Settings > Script
 * properties) or paste it into FALLBACK_API_KEY below. It stays server-side
 * and never reaches the browser.
 */

var FIFS_API_URL = 'https://medlem.fifs.se/api/validate-member';
var FALLBACK_API_KEY = '';

function doGet(e) {
  var pnr = e.parameter.pnr;

  // Validate PNR format
  var pnrRegex = /^\d{8}-\d{4}$/;
  if (!pnr || !pnrRegex.test(pnr)) {
    return jsonResponse({ error: 'Invalid PNR', isMember: false, memberSince: '', memberSinceFormatted: '' });
  }

  // Short cache (2 min) — absorbs double-clicks and softens the FIFS rate limits
  var cache = CacheService.getScriptCache();
  var cacheKey = 'fifs_pnr_' + pnr.replace(/[^0-9]/g, '');
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return jsonResponse(JSON.parse(cached));
  }

  var apiKey = PropertiesService.getScriptProperties().getProperty('FIFS_API_KEY') || FALLBACK_API_KEY;
  if (!apiKey) {
    Logger.log('FIFS proxy: API key missing — set Script Property FIFS_API_KEY');
    return jsonResponse({ error: 'FIFS API key not configured', isMember: false, memberSince: '', memberSinceFormatted: '' });
  }

  try {
    var response = UrlFetchApp.fetch(FIFS_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': apiKey },
      payload: JSON.stringify({ personnummer: pnr }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('FIFS API error ' + code + ' for ' + pnr);
      return jsonResponse({ error: 'FIFS API error ' + code, isMember: false, memberSince: '', memberSinceFormatted: '' });
    }

    var parsed = mapApiResult(JSON.parse(response.getContentText()));
    cache.put(cacheKey, JSON.stringify(parsed), 120);
    return jsonResponse(parsed);

  } catch (err) {
    Logger.log('FIFS proxy error: ' + err);
    return jsonResponse({ error: err.toString(), isMember: false, memberSince: '', memberSinceFormatted: '' });
  }
}

function mapApiResult(r) {
  var isMember = r.active === true;
  var memberSince = '';
  var memberSinceFormatted = '';

  if (isMember && r.memberSince) {
    memberSince = r.memberSince.slice(0, 10); // ISO → YYYY-MM-DD
    memberSinceFormatted = formatMemberSince(memberSince);
  }

  return {
    isMember: isMember,
    memberSince: memberSince,
    memberSinceFormatted: memberSinceFormatted
  };
}

function formatMemberSince(ymd) {
  var months = [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december'
  ];
  var parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  var mi = parseInt(parts[1], 10) - 1;
  var d = parseInt(parts[2], 10);
  return (mi >= 0 && mi < 12) ? d + ' ' + months[mi] + ' ' + parts[0] : ymd;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
