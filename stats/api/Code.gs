var DATA_SHEET_NAME_ = 'Sheet1';
var DATA_VISIBLE_COLUMN_COUNT_ = 5;
var DATA_SOURCE_TS_COLUMN_ = 7;       // column G — hidden, dedup key
var STATS_FORMULA_START_COL_ = 8;     // column H — hidden, computed aggregates
var STATS_FORMULA_END_COL_ = 11;      // column K — hidden, computed aggregates
var QUEUE_SHEET_NAME_ = '_queue';
var QUEUE_BATCH_SIZE_ = 200;
var DEDUP_LOOKBACK_HOURS_ = 1;       // scan last N hours for dedup
var DEDUP_MAX_SCAN_ROWS_ = 500;      // hard cap rows scanned
var QUEUE_DRAIN_BUDGET_MS_ = 250000;

function doPost(e) {
  try {
    // Trigger may fail in web-app context due to missing ScriptApp scope.
    // Run ensureQueueDrainTrigger() manually from the editor after first deploy.
    try { ensureQueueDrainTrigger(); } catch (triggerErr) { /* ok — trigger persists once created */ }
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var rows = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return json_({ ok: true, inserted: 0, skipped: 0 });
    }

    var preparedRows = rows.map(prepareRow_);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(1500)) {
      var queuedCount = enqueueRows_(rows);
      return json_({ ok: true, inserted: 0, skipped: 0, queued: queuedCount, deferred: true });
    }

    try {
      var sheet = getOrCreateSheet_(DATA_SHEET_NAME_);
      ensureHeader_(sheet);
      var queueSheet = getOrCreateSheet_(QUEUE_SHEET_NAME_);
      ensureQueueHeader_(queueSheet);

      var properties = PropertiesService.getScriptProperties();
      var queueBatch = dequeueQueueBatch_(queueSheet, QUEUE_BATCH_SIZE_);
      var queuePreparedRows = queueBatch.rows.map(prepareRow_);
      var allPreparedRows = queuePreparedRows.concat(preparedRows);

      var result = insertPreparedRows_(sheet, properties, allPreparedRows);

      if (queueBatch.count > 0) {
        ackQueueBatch_(queueSheet, queueBatch.count);
      }

      return json_({
        ok: true,
        inserted: result.inserted,
        skipped: result.skipped,
        queued: 0,
        processedFromQueue: queuePreparedRows.length,
        queueRemaining: countQueueRows_(queueSheet)
      });
    } finally {
      try {
        lock.releaseLock();
      } catch (ignoreRelease) {
      }
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function prepareRow_(r) {
  var sourceText = String((r && (r.text || r.message)) || '');
  var parsed = extractAmountAndMessage_(sourceText);
  var now = new Date();
  var dateValue = (r && r.date) || formatDate_(now);
  var timeValue = (r && r.time) || formatTime_(now);
  var accountValue = (r && r.account) || '';

  var androidAlreadyParsed = !!(r && r.amount);
  var rawAmount = androidAlreadyParsed
    ? String(r.amount)
    : (parsed.amount || '');
  var amountValue = parseAmountForSheet_(rawAmount);
  var messageValue = androidAlreadyParsed
    ? String((r && r.message) || '')
    : (sourceText !== '' ? parsed.message : String((r && r.message) || ''));

  var sourceTimestampValue = (r && r.sourceTimestamp) || '';

  return {
    dateValue: dateValue,
    timeValue: timeValue,
    accountValue: accountValue,
    amountValue: amountValue,
    messageValue: messageValue,
    sourceTimestampValue: sourceTimestampValue
  };
}

function insertPreparedRows_(sheet, properties, preparedRows) {
  var recentTimestamps = getRecentSourceTimestamps_(sheet);
  var requestTimestamps = {};
  var values = [];
  var skipped = 0;

  preparedRows.forEach(function (item) {
    var ts = item.sourceTimestampValue;

    if (ts) {
      if (requestTimestamps[ts] || recentTimestamps[ts]) {
        skipped += 1;
        return;
      }
      requestTimestamps[ts] = true;
    }

    values.push([
      item.dateValue,
      item.timeValue,
      item.accountValue,
      item.amountValue,
      item.messageValue,
      '',
      item.sourceTimestampValue || ''
    ]);
  });

  if (values.length > 0) {
    sheet.insertRowsAfter(1, values.length);
    sheet.getRange(2, 1, values.length, DATA_SOURCE_TS_COLUMN_).setValues(values);
  }

  return { inserted: values.length, skipped: skipped };
}

function ensureQueueHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.getRange(1, 1, 1, 2).setValues([['queued_at', 'raw_json']]);
}

function enqueueRows_(rows) {
  if (!rows || rows.length === 0) return 0;

  var lock = LockService.getDocumentLock();
  lock.waitLock(5000);
  try {
    var queueSheet = getOrCreateSheet_(QUEUE_SHEET_NAME_);
    ensureQueueHeader_(queueSheet);

    var now = formatIsoTimestamp_(new Date());
    var values = rows.map(function (row) {
      return [now, JSON.stringify(row || {})];
    });

    var start = queueSheet.getLastRow() + 1;
    queueSheet.getRange(start, 1, values.length, 2).setValues(values);
    return values.length;
  } finally {
    lock.releaseLock();
  }
}

function dequeueQueueBatch_(queueSheet, maxRows) {
  var lastRow = queueSheet.getLastRow();
  if (lastRow <= 1) {
    return { rows: [], count: 0 };
  }

  var available = lastRow - 1;
  var take = Math.min(maxRows, available);
  var values = queueSheet.getRange(2, 2, take, 1).getValues();
  var rows = [];

  values.forEach(function (entry) {
    var raw = String((entry && entry[0]) || '').trim();
    if (!raw) return;
    try {
      rows.push(JSON.parse(raw));
    } catch (ignore) {
    }
  });

  return { rows: rows, count: take };
}

function ackQueueBatch_(queueSheet, count) {
  if (count <= 0) return;
  queueSheet.deleteRows(2, count);
}

function countQueueRows_(queueSheet) {
  return Math.max(0, queueSheet.getLastRow() - 1);
}

// Reads source_ts from newest rows (row 2 downward) and returns a lookup set.
// Stops at first row older than DEDUP_LOOKBACK_HOURS_ or at DEDUP_MAX_SCAN_ROWS_.
// No PropertiesService needed — dedup is sheet-only.
function getRecentSourceTimestamps_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  var take = Math.min(lastRow - 1, DEDUP_MAX_SCAN_ROWS_);
  var cutoffMs = Date.now() - (DEDUP_LOOKBACK_HOURS_ * 3600 * 1000);

  var values = sheet.getRange(2, DATA_SOURCE_TS_COLUMN_, take, 1).getValues();
  var timestamps = {};

  for (var i = 0; i < values.length; i++) {
    var tsStr = String(values[i][0] || '').trim();
    if (!tsStr) continue;

    var tsMs = new Date(tsStr).getTime();
    if (isNaN(tsMs)) continue;
    if (tsMs < cutoffMs) break;

    timestamps[tsStr] = true;
  }

  return timestamps;
}

function processQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) {
    return { ok: false, retryable: true, code: 'LOCK_BUSY' };
  }

  try {
    var sheet = getOrCreateSheet_(DATA_SHEET_NAME_);
    ensureHeader_(sheet);
    var queueSheet = getOrCreateSheet_(QUEUE_SHEET_NAME_);
    ensureQueueHeader_(queueSheet);

    var properties = PropertiesService.getScriptProperties();
    var totalInserted = 0;
    var totalSkipped = 0;
    var totalProcessed = 0;
    var startMs = Date.now();

    while (true) {
      if (Date.now() - startMs > QUEUE_DRAIN_BUDGET_MS_) break;

      var queueBatch = dequeueQueueBatch_(queueSheet, QUEUE_BATCH_SIZE_);
      if (queueBatch.count === 0) break;

      var preparedRows = queueBatch.rows.map(prepareRow_);
      var result = insertPreparedRows_(sheet, properties, preparedRows);
      ackQueueBatch_(queueSheet, queueBatch.count);

      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalProcessed += queueBatch.count;
    }

    return {
      ok: true,
      inserted: totalInserted,
      skipped: totalSkipped,
      processedFromQueue: totalProcessed,
      queueRemaining: countQueueRows_(queueSheet)
    };
  } finally {
    lock.releaseLock();
  }
}

// Cached trigger check: only calls ScriptApp.getProjectTriggers() once every
// 100 doPost invocations, or if we haven't confirmed installation yet.
// This saves quota compared to the previous per-request check.
function ensureQueueDrainTrigger() {
  var props = PropertiesService.getScriptProperties();
  var checkCounter = parseInt(props.getProperty('trigger:check_counter') || '0', 10) + 1;
  var triggerInstalled = props.getProperty('trigger:installed') === '1';

  if (triggerInstalled && checkCounter < 100) {
    props.setProperty('trigger:check_counter', String(checkCounter));
    return { ok: true, triggerExists: true };
  }
  props.setProperty('trigger:check_counter', '0');

  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'processQueue';
  });

  if (!existing) {
    ScriptApp.newTrigger('processQueue')
      .timeBased()
      .everyMinutes(1)
      .create();
    props.setProperty('trigger:installed', '1');
  } else {
    props.setProperty('trigger:installed', '1');
  }

  return { ok: true, triggerExists: true };
}

function formatIsoTimestamp_(d) {
  return Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
}

function extractAmountAndMessage_(text) {
  var input = String(text || '');
  var amountRegex = /(\d{1,3}(?:[ \u00A0.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(kr|sek)\b/i;
  var match = input.match(amountRegex);

  if (!match) {
    return {
      amount: '',
      message: input.trim()
    };
  }

  var rawAmount = (match[1] || '').trim();
  var normalizedAmount = normalizeAmount_(rawAmount);

  var message = input.replace(match[0], '').trim();
  // Strip leading punctuation, then surrounding whitespace/quotes
  message = message.replace(/^[-:;,.]+\s*/, '').replace(/^[\s"']+|[\s"']+$/g, '').trim();

  return {
    amount: normalizedAmount,
    message: message
  };
}

function parseAmountForSheet_(input) {
  var s = String(input == null ? '' : input).trim();
  if (!s) return 0;
  s = s.replace(/[  ]/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') >= 0) {
    s = s.replace(',', '.');
  }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normalizeAmount_(raw) {
  var value = String(raw || '').replace(/[ \u00A0]/g, '');

  if (value.indexOf(',') >= 0 && value.indexOf('.') >= 0) {
    value = value.replace(/\./g, '');
    value = value.replace(',', '.');
    return value;
  }

  if (value.indexOf(',') >= 0 && value.indexOf('.') < 0) {
    var commaCount = (value.match(/,/g) || []).length;
    if (commaCount > 1) {
      return value.replace(/,/g, '');
    }
    return value.replace(',', '.');
  }

  if (value.indexOf('.') >= 0) {
    var dotCount = (value.match(/\./g) || []).length;
    if (dotCount > 1) {
      return value.replace(/\./g, '');
    }
  }

  return value;
}

function formatDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatTime_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm:ss');
}

function getOrCreateSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function ensureHeader_(sheet) {
  var neededCols = Math.max(DATA_SOURCE_TS_COLUMN_, STATS_FORMULA_END_COL_);
  if (sheet.getMaxColumns() < neededCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, DATA_SOURCE_TS_COLUMN_).setValues([
      ['date', 'time', 'account', 'amount', 'message', '', 'source_ts']
    ]);
  } else {
    if (!String(sheet.getRange(1, DATA_SOURCE_TS_COLUMN_).getValue() || '').trim()) {
      sheet.getRange(1, DATA_SOURCE_TS_COLUMN_).setValue('source_ts');
    }
  }

  // Pre-computed aggregate formulas (row 1, columns H–K).
  // Read by the GET endpoint instead of scanning all rows.
  sheet.getRange(1, STATS_FORMULA_START_COL_, 1, 4).setFormulas([[
    '=IFERROR(SUM(D2:D), 0)',
    '=IFERROR(SUMIF(A2:A, TEXT(TODAY(), "yyyy-MM-dd"), D2:D), 0)',
    '=IFERROR(MAXIFS(D2:D, A2:A, TEXT(TODAY(), "yyyy-MM-dd")), 0)',
    '=IFERROR(COUNTIF(A2:A, TEXT(TODAY(), "yyyy-MM-dd")), 0)'
  ]]);

  sheet.hideColumns(6, 2);
  sheet.hideColumns(STATS_FORMULA_START_COL_, 4);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
