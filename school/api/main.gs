// === Alsalam School Registration — Consolidated Backend ===
const SHEET_NAME = 'Alsalam Skola Website';
const scriptProp = PropertiesService.getScriptProperties();

function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  scriptProp.setProperty('key', ss.getId());
}

// ── GET: School parent lookup (for membership checker) ────────────────
function doGet(e) {
  try {
    const key = scriptProp.getProperty('key');
    if (!key) {
      return json({ result: 'error', error: 'Script property "key" is not set.' });
    }

    const doc = SpreadsheetApp.openById(key);
    const sheet = doc.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return json({ result: 'error', error: 'Sheet not found.' });
    }

    const params = normalizeParams(e.parameters || {});
    const pnr = getParam(params, 'pnr');
    if (!pnr) {
      return json({ found: false, childrenCount: 0, children: [] });
    }

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // Use existing findRowsBySSN – matches father (col G) and mother (col K)
    const matched = findRowsBySSN(sheet, headers, pnr);
    if (matched.length === 0) {
      return json({ found: false, childrenCount: 0, children: [] });
    }

    // Collect children from matched rows, dedup by SSN
    const childNameCol = headers.indexOf('Barnets namn');
    const childSSNCol  = headers.indexOf('Barnets Personnummer');
    const seen = {};
    const children = [];

    const allData = sheet.getDataRange().getValues();
    for (const m of matched) {
      const row = allData[m.row - 1]; // m.row is 1-indexed
      const childSSN = String(row[childSSNCol]).replace(/[^0-9]/g, '');
      if (!seen[childSSN]) {
        seen[childSSN] = true;
        children.push({
          name: String(childNameCol !== -1 ? (row[childNameCol] || '') : ''),
          ssn: childSSN
        });
      }
    }

    return json({ found: true, childrenCount: children.length, children });
  } catch (err) {
    return json({ result: 'error', error: err.toString() });
  }
}

// ── Router ──────────────────────────────────────────────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const key = scriptProp.getProperty('key');
    if (!key) {
      return json({ result: 'error', error: 'Script property "key" is not set. Run initialSetup() first.' });
    }

    const doc = SpreadsheetApp.openById(key);
    if (!doc) {
      return json({ result: 'error', error: 'Spreadsheet not found. Check that the "key" property points to a valid spreadsheet ID.' });
    }

    let sheet = doc.getSheetByName(SHEET_NAME);
    if (!sheet) {
      // Fallback: list available sheets in the error so it's self-diagnosing
      const sheets = doc.getSheets().map(s => s.getName()).join(', ');
      return json({
        result: 'error',
        error: 'Sheet "' + SHEET_NAME + '" not found. Available sheets: ' + sheets
      });
    }

    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) {
      return json({ result: 'error', error: 'Sheet "' + SHEET_NAME + '" is empty — no header row found.' });
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const params = normalizeParams(e.parameters || {});
    const action = getParam(params, 'action');

    switch (action) {
      case 'updatePayments':
        return json(updatePayments(sheet, headers, params));
      case 'markMonthlyPaid':
        return json(markMonthlyPaid(sheet, headers, params));
      default:
        return json(processRegistration(sheet, headers, params));
    }
  } catch (err) {
    return json({ result: 'error', error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeParams(raw) {
  const out = {};
  Object.keys(raw).forEach(k => { out[k.replace(/\[\]$/, '')] = raw[k]; });
  return out;
}

function getParam(params, name) {
  const v = params[name];
  return Array.isArray(v) ? v[0] : (v || '');
}

function formatDate(date) {
  return Utilities.formatDate(date, 'Europe/Stockholm', 'yyyy-MM-dd HH:mm:ss');
}

/** Ensure the value is an array (Apps Script may collapse single-element arrays). */
function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ── Registration ────────────────────────────────────────────────────
function processRegistration(sheet, headers, params) {
  const childFirstNames = asArray(params['Barnet Förnamn']);
  const childSSNs = asArray(params['Barnets Personnummer']);
  const childLastName = getParam(params, 'Barnet Efternamn');

  const parentType = getParam(params, 'parentType'); // 'father' | 'mother'
  const p1Name  = getParam(params, 'Förälder 1 Namn');
  const p1SSN   = getParam(params, 'Förälder 1 Personnummer');
  const p1Mobile = getParam(params, 'Förälder 1 Mobilnummer');
  const p1Email  = getParam(params, 'Förälder 1 Email');
  const p2Name   = getParam(params, 'Förälder 2 Namn');
  const p2SSN    = getParam(params, 'Förälder 2 Personnummer');
  const p2Mobile = getParam(params, 'Förälder 2 Mobilnummer');
  const p2Email  = getParam(params, 'Förälder 2 Email');

  const ssnCol = headers.indexOf('Barnets Personnummer');
  const dateCol = headers.indexOf('RegistreringsDatum');

  // Read existing rows for dedup
  const lastRow = sheet.getLastRow();
  const existing = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    : [];

  function buildRow(firstName, ssn) {
    return headers.map(h => {
      // Child fields
      if (h === 'Barnet Förnamn')     return firstName;
      if (h === 'Barnet Efternamn')   return childLastName;
      if (h === 'Barnets Personnummer') return String(ssn);
      if (h === 'Barnets namn')       return firstName + ' ' + childLastName;
      if (h === 'skoldag')            return getParam(params, 'skoldag');

      // Parent 1 → Pappa or Mamma columns based on parentType
      if (parentType === 'father') {
        if (h === 'Pappans Namn')         return p1Name;
        if (h === 'Pappans Personnummer') return p1SSN;
        if (h === 'Pappans Mobilnummer')  return p1Mobile;
        if (h === 'Pappans Email')        return p1Email;
        if (h === 'Mammans Namn')         return p2Name;
        if (h === 'Mammans Personnummer') return p2SSN;
        if (h === 'Mammans Mobilnummer')  return p2Mobile;
        if (h === 'Mammans Email')        return p2Email;
      } else {
        // parentType === 'mother'
        if (h === 'Mammans Namn')         return p1Name;
        if (h === 'Mammans Personnummer') return p1SSN;
        if (h === 'Mammans Mobilnummer')  return p1Mobile;
        if (h === 'Mammans Email')        return p1Email;
        if (h === 'Pappans Namn')         return p2Name;
        if (h === 'Pappans Personnummer') return p2SSN;
        if (h === 'Pappans Mobilnummer')  return p2Mobile;
        if (h === 'Pappans Email')        return p2Email;
      }

      // Address
      if (h === 'Adress')     return getParam(params, 'Adress');
      if (h === 'Postnummer') return getParam(params, 'Postnummer');
      if (h === 'Postort')    return getParam(params, 'Postort');

      if (h === 'RegistreringsDatum') return formatDate(new Date());
      return '';
    });
  }

  let added = 0, updated = 0;
  for (let i = 0; i < childFirstNames.length; i++) {
    const fn  = childFirstNames[i];
    const ssn = String(childSSNs[i]);
    const newRow = buildRow(fn, ssn);
    const idx = existing.findIndex(r => String(r[ssnCol]).replace(/[^0-9]/g, '') === ssn.replace(/[^0-9]/g, ''));

    if (idx !== -1) {
      // Preserve admin-managed columns that the form does not know about
      // (set by the school-admin kanban: class assignment and books flag).
      const klassCol = headers.indexOf('klass');
      const booksCol = headers.indexOf('Böcker');
      if (klassCol !== -1) newRow[klassCol] = existing[idx][klassCol];
      if (booksCol !== -1) newRow[booksCol] = existing[idx][booksCol];
      sheet.getRange(idx + 2, 1, 1, headers.length).setValues([newRow]);
      updated++;
    } else {
      sheet.appendRow(newRow);
      added++;
    }
  }

  return { result: 'done', added, updated };
}

// ── Payment Update (via Stripe session) ─────────────────────────────
function updatePayments(sheet, headers, params) {
  const sessionId = getParam(params, 'session_id');
  const env       = getParam(params, 'env');

  const stripe = getStripeSession(sessionId, env);
  if (!stripe || stripe.result === 'error') return stripe;

  const stripeEmail = stripe.customerEmail;
  const stripeSSN   = String(stripe.clientReferenceId);

  let matched = [];

  // 1) Try matching by SSN (client_reference_id) — Pappans or Mammans
  if (stripeSSN) {
    matched = findRowsBySSN(sheet, headers, stripeSSN);
  }

  // 2) Fallback: match by email
  if (matched.length === 0 && stripeEmail) {
    matched = findRowsByEmail(sheet, headers, stripeEmail);
  }

  // 3) Update matched rows
  if (matched.length > 0) {
    applyPaymentUpdate(sheet, headers, matched, stripeEmail);
  }

  return {
    result: matched.length > 0 ? 'updated' : 'no_match',
    updatedCount: matched.length
  };
}

// ── Manual monthly-payment flag (cash payers) ───────────────────────
function markMonthlyPaid(sheet, headers, params) {
  const pnr = getParam(params, 'pnr');
  const matched = findRowsBySSN(sheet, headers, pnr);

  if (matched.length > 0) {
    applyPaymentUpdate(sheet, headers, matched, null);
  }

  return { result: matched.length > 0 ? 'done' : 'no_match', updatedCount: matched.length };
}

// ── Sheet lookups ───────────────────────────────────────────────────
function findRowsBySSN(sheet, headers, ssn) {
  const data = sheet.getDataRange().getValues();
  const fatherCol = headers.indexOf('Pappans Personnummer');
  const motherCol = headers.indexOf('Mammans Personnummer');
  const dateCol   = headers.indexOf('RegistreringsDatum');
  const results   = [];
  const normSSN   = ssn.replace(/[^0-9]/g, '');

  for (let i = 1; i < data.length; i++) {
    const fatherNorm = String(data[i][fatherCol]).replace(/[^0-9]/g, '');
    const motherNorm = String(data[i][motherCol]).replace(/[^0-9]/g, '');
    if (fatherNorm === normSSN || motherNorm === normSSN) {
      results.push({ row: i + 1, date: new Date(data[i][dateCol]) });
    }
  }
  return results.sort((a, b) => a.date - b.date);
}

function findRowsByEmail(sheet, headers, email) {
  const data = sheet.getDataRange().getValues();
  const fatherEmailCol = headers.indexOf('Pappans Email');
  const motherEmailCol = headers.indexOf('Mammans Email');
  const dateCol = headers.indexOf('RegistreringsDatum');
  const results = [];
  const norm = email.toLowerCase().trim();

  for (let i = 1; i < data.length; i++) {
    const fe = String(data[i][fatherEmailCol]).toLowerCase().trim();
    const me = String(data[i][motherEmailCol]).toLowerCase().trim();
    if (fe === norm || me === norm) {
      results.push({ row: i + 1, date: new Date(data[i][dateCol]) });
    }
  }
  return results.sort((a, b) => a.date - b.date);
}

function applyPaymentUpdate(sheet, headers, matched, email) {
  const payCol        = headers.indexOf('Månatligbetalning');
  const fatherEmailCol = headers.indexOf('Pappans Email');
  const motherEmailCol = headers.indexOf('Mammans Email');
  const dateCol       = headers.indexOf('RegistreringsDatum');

  for (const m of matched) {
    if (payCol !== -1)  sheet.getRange(m.row, payCol + 1).setValue('J');
    if (dateCol !== -1) sheet.getRange(m.row, dateCol + 1).setValue(formatDate(new Date()));

    // Fill the first empty parent-email column
    if (email && fatherEmailCol !== -1 && motherEmailCol !== -1) {
      const curFather = String(sheet.getRange(m.row, fatherEmailCol + 1).getValue()).trim();
      const curMother = String(sheet.getRange(m.row, motherEmailCol + 1).getValue()).trim();
      if (!curFather) {
        sheet.getRange(m.row, fatherEmailCol + 1).setValue(email);
      } else if (!curMother) {
        sheet.getRange(m.row, motherEmailCol + 1).setValue(email);
      }
    }
  }
}

// ── Stripe ──────────────────────────────────────────────────────────
function getStripeSession(sessionId, env) {
  const secret = env === 'test'
    ? scriptProp.getProperty('stripe_secret_key_test')
    : scriptProp.getProperty('stripe_secret_key');

  const url = 'https://api.stripe.com/v1/checkout/sessions/' + sessionId;

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + secret }
    });
    const obj = JSON.parse(resp.getContentText());

    return {
      result: 'success',
      customerId: obj.customer || '',
      customerEmail: obj.customer_details?.email || '',
      clientReferenceId: obj.client_reference_id || '',
      paymentStatus: obj.payment_status || ''
    };
  } catch (e) {
    return { result: 'error', error: e.toString() };
  }
}
