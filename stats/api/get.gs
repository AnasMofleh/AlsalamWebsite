function doGet(e) {
  try {
    var sheet = getOrCreateSheet_('Sheet1');
    ensureHeader_(sheet);

    var summary = buildSummary_(sheet);
    return json_({ ok: true, data: summary });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function buildSummary_(sheet) {
  var lastRow = sheet.getLastRow();

  // ── Read pre-computed aggregates from formula cells (row 1, cols H–K) ──
  // These are maintained by ensureHeader_() and recalculated by Sheets instantly.
  var statsCells = sheet.getRange(1, 8, 1, 4).getValues()[0];
  var totalAmount = Number(statsCells[0]) || 0;
  var todayTotal  = Number(statsCells[1]) || 0;
  var todayHighest = Number(statsCells[2]) || 0;
  var todayCount   = Number(statsCells[3]) || 0;

  // ── Read only the 5 most recent rows (inserted at row 2) ──
  var last5 = [];
  if (lastRow > 1) {
    var rowsToRead = Math.min(5, lastRow - 1);
    var values = sheet.getRange(2, 1, rowsToRead, 5).getValues();
    var tz = Session.getScriptTimeZone();

    last5 = values.map(function (r) {
      return {
        date: formatDateValue_(r[0], tz),
        time: formatTimeValue_(r[1], tz),
        account: String(r[2] == null ? '' : r[2]),
        amount: parseAmountValue_(r[3]),
        message: String(r[4] == null ? '' : r[4])
      };
    });
  }

  return {
    totalAmount: round2_(totalAmount),
    last5: last5,
    todayTotal: round2_(todayTotal),
    todayHighest: round2_(todayHighest),
    todayCount: todayCount
  };
}

function parseAmountValue_(input) {
  var s = String(input == null ? '' : input).trim();
  if (!s) return 0;

  // Handles: "1 000", "2,6", "1.000,50", "1000.50"
  s = s.replace(/[ \u00A0]/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') >= 0) {
    s = s.replace(',', '.');
  }

  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function formatDateValue_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v);
}

function formatTimeValue_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, tz, 'HH:mm');
  }

  var s = String(v == null ? '' : v).trim();
  var m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}