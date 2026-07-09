/**
 * Google Apps Script — Membership Sheet Proxy
 *
 * Reads the Al Salam members spreadsheet and returns monthly donor (Autogiro)
 * status for a given personnummer.
 *
 * Deploy as a web app:
 *   1. Deploy > New deployment > Web app
 *   2. Execute as: Me
 *   3. Who has access: Anyone
 *   4. Copy the deployment URL and replace YOUR_DEPLOYMENT_ID_SHEET
 *      in membership-check/index.html
 *
 * Usage: /exec?pnr=YYYYMMDD-XXXX
 * Returns: { found, name, isFifsInSheet, isMonthlyDonor, monthlyAmount }
 *
 * Spreadsheet columns (1-indexed):
 *   A: Name          B: SIS          C: FIFS         D: Autogiro
 *   E: amount        F: tel nummer   G: kommentar 1  H: personnummer
 */

function doGet(e) {
  var pnr = e.parameter.pnr;

  // Validate PNR format
  var pnrRegex = /^\d{8}-\d{4}$/;
  if (!pnr || !pnrRegex.test(pnr)) {
    return jsonResponse({
      error: 'Invalid PNR',
      found: false,
      name: '',
      isFifsInSheet: false,
      isMonthlyDonor: false,
      monthlyAmount: 0
    });
  }

  // ============================================================
  // REPLACE with your actual Google Sheet ID
  // ============================================================
  var SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getActiveSheet();

    var data = sheet.getDataRange().getValues();

    // Normalize input PNR: strip dash and any non-digit characters
    var pnrClean = pnr.replace(/[^0-9]/g, '');

    // Skip header row (index 0), iterate through data rows
    for (var i = 1; i < data.length; i++) {
      var row = data[i];

      // Column H (index 7): personnummer — strip non-digits for robust matching
      var rowPnr = String(row[7] || '').replace(/[^0-9]/g, '');

      if (rowPnr === pnrClean) {
        var autogiro = String(row[3] || '').trim().toUpperCase(); // Column D
        var amount = Number(row[4]) || 0;                          // Column E

        return jsonResponse({
          found: true,
          name: String(row[0] || ''),                              // Column A
          isFifsInSheet: String(row[2] || '').trim().toUpperCase() === 'J', // Column C
          isMonthlyDonor: autogiro === 'J',
          monthlyAmount: amount
        });
      }
    }

    // PNR not found in sheet
    return jsonResponse({
      found: false,
      name: '',
      isFifsInSheet: false,
      isMonthlyDonor: false,
      monthlyAmount: 0
    });

  } catch (err) {
    return jsonResponse({
      error: err.toString(),
      found: false,
      name: '',
      isFifsInSheet: false,
      isMonthlyDonor: false,
      monthlyAmount: 0
    });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
