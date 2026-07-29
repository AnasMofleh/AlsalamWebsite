/**
 * Google Apps Script — Membership Sheet
 *
 * GET  /exec?pnr=YYYYMMDD-XXXX
 *   Reads the Al Salam members spreadsheet and returns monthly donor (Autogiro)
 *   status for a given personnummer.
 *
 * POST /exec  { action: "record-monthly", session_id: "cs_..." }
 *   Retrieves the Stripe Checkout Session, extracts personnummer from either
 *   client_reference_id (membership-portal flow) or custom_fields (direct payment-link
 *   flow), then updates or inserts a row in the monthly-donors sheet.
 *
 * Deploy as a web app:
 *   1. Deploy > New deployment > Web app
 *   2. Execute as: Me
 *   3. Who has access: Anyone
 *
 * Script properties (set via File > Project Properties > Script Properties):
 *   SPREADSHEET_ID    — the Google Sheet ID for the monthly-donors sheet
 *   STRIPE_SECRET_KEY — Stripe secret key (sk_live_… or sk_test_…)
 *
 * Spreadsheet columns (1-indexed):
 *   A: Name          B: SIS          C: FIFS         D: Autogiro
 *   E: amount        F: tel nummer   G: kommentar 1  H: personnummer
 *   (email column to be added later)
 */

// ═══════════════════════════════════════════════════════════════
// Load secrets from script properties
// ═══════════════════════════════════════════════════════════════

function getSpreadsheetId() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
}

function getStripeSecretKey() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
}

// ── doGet: read-only membership lookup ───────────────────────

function doGet(e) {
  var SPREADSHEET_ID = getSpreadsheetId();
  var pnr = e.parameter.pnr;

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

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();

    var pnrClean = pnr.replace(/[^0-9]/g, '');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowPnr = String(row[7] || '').replace(/[^0-9]/g, '');

      if (rowPnr === pnrClean) {
        var autogiro = String(row[3] || '').trim().toUpperCase();
        var amount = Number(row[4]) || 0;

        return jsonResponse({
          found: true,
          name: String(row[0] || ''),
          isFifsInSheet: String(row[2] || '').trim().toUpperCase() === 'J',
          isMonthlyDonor: autogiro === 'J',
          monthlyAmount: amount
        });
      }
    }

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

// ── doPost: record monthly donation from Stripe session ─────

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ status: 'error', error: 'Invalid JSON body' });
  }

  var action = payload.action;

  if (action === 'record-monthly') {
    return handleRecordMonthly(payload.session_id);
  }

  return jsonResponse({ status: 'error', error: 'Unknown action: ' + action });
}

// ═══════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════

function handleRecordMonthly(sessionId) {
  if (!sessionId) {
    return jsonResponse({ status: 'error', error: 'Missing session_id' });
  }

  var SPREADSHEET_ID = getSpreadsheetId();

  // 1. Retrieve the Stripe Checkout Session
  var session;
  try {
    session = retrieveStripeSession(sessionId);
  } catch (err) {
    return jsonResponse({ status: 'error', error: 'Failed to retrieve Stripe session: ' + err.toString() });
  }

  // 2. Extract data from session
  var email = (session.customer_details && session.customer_details.email) || '';
  var name = (session.customer_details && session.customer_details.name) || '';
  var amountOre = session.amount_total || 0;
  var amountSek = Math.round(amountOre / 100);

  // 3. Extract personnummer from TWO possible sources:
  //
  //    Flow A — Membership portal "Öka Sadaqa" button:
  //      Passed via client_reference_id in the URL:
  //      ?client_reference_id=YYYYMMDD-XXXX
  //
  //    Flow B — Direct payment-link visit:
  //      User fills in the obligatory "Personnummer 12 siffror" field.
  //      That value lives in session.custom_fields as a numeric field.
  //
  var pnrRaw = extractPersonnummer(session);

  // Normalise to canonical YYYYMMDD-XXXX
  var pnr = normalisePnr(pnrRaw);
  if (!pnr) {
    return jsonResponse({
      status: 'skipped',
      reason: 'No valid personnummer found — checked client_reference_id and custom_fields',
      pnrRaw: pnrRaw || '(empty)',
      session_id: sessionId
    });
  }

  // If there's no name in Stripe, use the email local-part as a fallback
  if (!name && email) {
    name = email.split('@')[0];
  }

  // 4. Update the sheet
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    var lastRow = data.length;

    var pnrClean = pnr.replace(/[^0-9]/g, '');
    var foundRow = -1;

    for (var i = 1; i < data.length; i++) {
      var rowPnr = String(data[i][7] || '').replace(/[^0-9]/g, '');
      if (rowPnr === pnrClean) {
        foundRow = i + 1;
        break;
      }
    }

    var source = pnrRaw === (session.client_reference_id || '') ? 'client_reference_id' : 'custom_field';

    if (foundRow > 0) {
      // ── UPDATE existing row ──────────────────────────
      var existingAmount = Number(data[foundRow - 1][4]) || 0;  // E: current amount
      var newTotal = existingAmount + amountSek;                 // add new donation
      sheet.getRange(foundRow, 4).setValue('J');                // D: Autogiro
      sheet.getRange(foundRow, 5).setValue(newTotal);           // E: amount
      if (name) {
        sheet.getRange(foundRow, 1).setValue(name);             // A: Name
      }

      return jsonResponse({
        status: 'ok',
        action: 'updated',
        row: foundRow,
        pnr: pnr,
        name: name,
        email: email,
        amount: amountSek,
        source: source
      });
    } else {
      // ── INSERT new row ──────────────────────────────
      var newRow = lastRow + 1;
      sheet.getRange(newRow, 1).setValue(name || '');
      sheet.getRange(newRow, 2).setValue('');
      sheet.getRange(newRow, 3).setValue('');
      sheet.getRange(newRow, 4).setValue('J');
      sheet.getRange(newRow, 5).setValue(amountSek);
      sheet.getRange(newRow, 6).setValue('');
      sheet.getRange(newRow, 7).setValue('Stripe monthly — ' + source);
      sheet.getRange(newRow, 8).setValue(pnr);

      return jsonResponse({
        status: 'ok',
        action: 'inserted',
        row: newRow,
        pnr: pnr,
        name: name,
        email: email,
        amount: amountSek,
        source: source
      });
    }

  } catch (err) {
    return jsonResponse({ status: 'error', error: 'Sheet update failed: ' + err.toString() });
  }
}

// ═══════════════════════════════════════════════════════════════
// Personnummer helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Tries to extract a personnummer from the Stripe session.
 *
 * Priority:
 *  1. client_reference_id  (Flow A — membership portal button)
 *  2. custom_fields         (Flow B — direct payment link)
 *
 * Returns the raw string or "" if nothing found.
 */
function extractPersonnummer(session) {
  // 1. Try client_reference_id
  var ref = (session.client_reference_id || '').trim();
  if (ref) return ref;

  // 2. Scan custom_fields for a personnummer-like key or label
  var customFields = session.custom_fields || [];
  for (var i = 0; i < customFields.length; i++) {
    var f = customFields[i];

    // Build a searchable string from key + label
    var key = (f.key || '').toLowerCase();
    var labelCustom = '';
    if (f.label && f.label.custom) {
      labelCustom = f.label.custom.toLowerCase();
    }

    if (key.indexOf('personnummer') !== -1 || labelCustom.indexOf('personnummer') !== -1) {
      // Extract value based on field type
      if (f.type === 'numeric' && f.numeric && f.numeric.value) {
        return String(f.numeric.value);
      }
      if (f.type === 'text' && f.text && f.text.value) {
        return String(f.text.value);
      }
    }
  }

  return '';
}

/**
 * Normalises a raw personnummer string into canonical YYYYMMDD-XXXX format.
 *
 * Accepts:
 *   - "19900101-1234"  (already correct)
 *   - "199001011234"    (12 digits)
 *   - "900101-1234"     (10-digit with dash — assumes 1900/2000)
 *   - "9001011234"      (10 digits — assumes 1900/2000)
 *   - with or without spaces
 *
 * Returns the canonical form, or "" if the input cannot be parsed.
 */
function normalisePnr(raw) {
  if (!raw) return '';

  // Strip everything except digits
  var digits = String(raw).replace(/[^0-9]/g, '');

  // We expect either 10 or 12 digits
  if (digits.length !== 10 && digits.length !== 12) {
    return '';
  }

  if (digits.length === 12) {
    // 199001011234  → 19900101-1234
    return digits.slice(0, 8) + '-' + digits.slice(8);
  }

  // 10 digits: 9001011234 → need century guess
  // Swedish personnummer: first 6 = YYMMDD, last 4 = XXXX
  var yy = parseInt(digits.slice(0, 2), 10);
  var mm = parseInt(digits.slice(2, 4), 10);
  var dd = parseInt(digits.slice(4, 6), 10);
  var last4 = digits.slice(6);

  // Quick sanity: months 1-12, days 1-31
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';

  // Century heuristic: if yy > current short-year, assume 19xx; else 20xx
  var currentShortYear = new Date().getFullYear() % 100;
  var century = yy > currentShortYear ? '19' : '20';
  var fullYear = century + String(yy).padStart(2, '0');

  return fullYear + digits.slice(2, 4) + digits.slice(4, 6) + '-' + last4;
}

// ═══════════════════════════════════════════════════════════════
// Stripe API helper
// ═══════════════════════════════════════════════════════════════

function retrieveStripeSession(sessionId) {
  var STRIPE_SECRET_KEY = getStripeSecretKey();
  var url = 'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId);

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + STRIPE_SECRET_KEY
    },
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());

  if (code !== 200) {
    throw new Error('Stripe API error ' + code + ': ' + (body.error && body.error.message || 'Unknown'));
  }

  return body;
}

// ═══════════════════════════════════════════════════════════════
// JSON helper
// ═══════════════════════════════════════════════════════════════

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
