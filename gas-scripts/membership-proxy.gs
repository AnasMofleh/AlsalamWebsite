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
 */

function doGet(e) {
  var pnr = e.parameter.pnr;

  // Validate PNR format
  var pnrRegex = /^\d{8}-\d{4}$/;
  if (!pnr || !pnrRegex.test(pnr)) {
    return jsonResponse({ error: 'Invalid PNR', isMember: false, memberSince: '', memberSinceFormatted: '' });
  }

  var url = 'https://medlem.fifs.se/registrera/' + encodeURIComponent(pnr) + '/SCH';

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var html = response.getContentText();

    var parsed = parseMembershipHtml(html);
    return jsonResponse(parsed);

  } catch (err) {
    return jsonResponse({ error: err.toString(), isMember: false, memberSince: '', memberSinceFormatted: '' });
  }
}

function parseMembershipHtml(html) {
  var isMember = /Du är redan medlem/i.test(html) || /är redan medlem/i.test(html);
  var memberSince = '';
  var memberSinceFormatted = '';

  if (isMember) {
    var dm = html.match(/sedan\s*(\d{4})-(\d{2})-(\d{2})/i);
    if (!dm) dm = html.match(/medlem.*?(\d{4})-(\d{2})-(\d{2})/is);
    if (!dm) dm = html.match(/(\d{4})-(\d{2})-(\d{2})/);

    if (dm) {
      memberSince = dm[1] + '-' + dm[2] + '-' + dm[3];
      var months = [
        'januari', 'februari', 'mars', 'april', 'maj', 'juni',
        'juli', 'augusti', 'september', 'oktober', 'november', 'december'
      ];
      var mi = parseInt(dm[2], 10) - 1;
      var d = parseInt(dm[3], 10);
      memberSinceFormatted = (mi >= 0 && mi < 12) ? d + ' ' + months[mi] + ' ' + dm[1] : memberSince;
    }
  }

  return {
    isMember: isMember,
    memberSince: memberSince,
    memberSinceFormatted: memberSinceFormatted
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
