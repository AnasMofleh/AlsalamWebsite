/**
 * Google Apps Script — School Admin Kanban + Teacher Attendance Backend
 *
 * Serves the school-admin pages:
 *   - school-admin/index.html   (admin: kanban board, classes, teachers)
 *   - school-admin/teacher.html (teachers: attendance)
 *
 * Reads/writes the SAME spreadsheet as the school registration backend
 * (school/api/main.gs), sheet "Alsalam Skola Website", plus three new tabs:
 *   Klasser, Lärare, Närvaro — created automatically on first request.
 *
 * DEPLOYMENT:
 * 1. Go to https://script.google.com → New project
 * 2. Paste this entire file into Code.gs
 * 3. Project Settings → Script properties, add:
 *      key            = the school spreadsheet ID (same value as the
 *                       registration project's "key" property, or copy it
 *                       from the sheet URL: docs.google.com/spreadsheets/d/<ID>/edit)
 *      ADMIN_PASSWORD = a strong password for the admin page
 *      TOKEN_SECRET   = 64 random hex chars (e.g. two UUIDs without dashes)
 * 4. Deploy → New Deployment → Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. Copy the /exec URL into GAS_URL in BOTH:
 *      school-admin/index.html and school-admin/teacher.html
 * 6. No manual sheet setup — the first POST creates the tabs and adds the
 *    "klass" and "Böcker" headers to "Alsalam Skola Website".
 *    (If a "klass" header already exists there, make sure it is spelled
 *    exactly "klass", lowercase.)
 * 7. Also apply the 3-line fix in school/api/main.gs (processRegistration
 *    must preserve klass/Böcker when a parent re-registers an existing
 *    child) and deploy a NEW VERSION of that web app — otherwise
 *    re-registrations wipe class and book data.
 *
 * NOTE: attendance can be recorded for this week's or last week's
 * class-day (the two sessions shown to the teacher) — no day restriction.
 * Older dates can be corrected directly in the Närvaro tab.
 */

const SCHOOL_SHEET = 'Alsalam Skola Website';
const TAB_KLASSER  = 'Klasser';
const TAB_LARARE   = 'Lärare';
const TAB_NARVARO  = 'Närvaro';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (admin/teacher sessions)
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (assistant share links)

const HEADER_FIELDS = [
  'Barnet Förnamn', 'Barnet Efternamn', 'Barnets Personnummer', 'Barnets namn',
  'skoldag', 'klass', 'Böcker', 'Månatligbetalning',
  'Pappans Namn', 'Pappans Personnummer', 'Pappans Mobilnummer', 'Pappans Email',
  'Mammans Namn', 'Mammans Personnummer', 'Mammans Mobilnummer', 'Mammans Email',
  'Adress', 'Postnummer', 'Postort', 'RegistreringsDatum'
];

const scriptProp = PropertiesService.getScriptProperties();

function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  scriptProp.setProperty('key', ss.getId());
}

// ── GET: status ─────────────────────────────────────────────────
function doGet(e) {
  return json({
    status: 'ok',
    usage: 'POST with action=... (see school-admin pages)'
  });
}

// ── Router ──────────────────────────────────────────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const key = scriptProp.getProperty('key');
    if (!key) {
      return json({ success: false, error: 'Script property "key" is not set. Run initialSetup() first.' });
    }

    const doc = SpreadsheetApp.openById(key);
    ensureSchema(doc);

    const params = normalizeParams(e.parameters || {});
    const action = getParam(params, 'action');

    switch (action) {
      case 'admin-login':
        return json(adminLogin(params));
      case 'teacher-login':
        return json(teacherLogin(doc, params));

      case 'get-board':
        return json(guardAdmin(params, function() { return getBoard(doc); }));
      case 'update-student':
        return json(guardAdmin(params, function() { return updateStudent(doc, params); }));
      case 'set-klass':
        return json(guardAdmin(params, function() { return setKlass(doc, params); }));
      case 'add-student':
        return json(guardAdmin(params, function() { return addStudent(doc, params); }));

      case 'list-classes':
        return json(guardAdmin(params, function() { return listClasses(doc); }));
      case 'add-class':
        return json(guardAdmin(params, function() { return addClass(doc, params); }));
      case 'rename-class':
        return json(guardAdmin(params, function() { return renameClass(doc, params); }));
      case 'delete-class':
        return json(guardAdmin(params, function() { return deleteClass(doc, params); }));
      case 'update-class':
        return json(guardAdmin(params, function() { return updateClass(doc, params); }));

      case 'list-teachers':
        return json(guardAdmin(params, function() { return listTeachers(doc); }));
      case 'add-teacher':
        return json(guardAdmin(params, function() { return addTeacher(doc, params); }));
      case 'update-teacher':
        return json(guardAdmin(params, function() { return updateTeacher(doc, params); }));
      case 'delete-teacher':
        return json(guardAdmin(params, function() { return deleteTeacher(doc, params); }));
      case 'reset-teacher-password':
        return json(guardAdmin(params, function() { return resetTeacherPassword(doc, params); }));

      case 'teacher-board':
        return json(guardTeacher(params, function(pnr) { return teacherBoard(doc, pnr); }));
      case 'mark-attendance':
        return json(guardTeacher(params, function(pnr) { return markAttendance(doc, pnr, params); }));
      case 'share-teacher':
        return json(guardTeacher(params, function(pnr) { return { success: true, token: signToken('share:' + pnr, SHARE_TTL_MS) }; }));

      default:
        return json({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ── Auth guards ─────────────────────────────────────────────────
function guardAdmin(params, fn) {
  const t = verifyToken(getParam(params, 'token'));
  if (!t || t.subject !== 'admin') return { success: false, error: 'auth' };
  return fn();
}

function guardTeacher(params, fn) {
  const t = verifyToken(getParam(params, 'token'));
  if (!t || t.subject === 'admin') return { success: false, error: 'auth' };
  // Teacher sessions use the bare PNR as subject; assistant share links
  // use "share:" + PNR — both map to the same teacher identity.
  let pnr = t.subject;
  if (pnr.indexOf('share:') === 0) pnr = pnr.substring(6);
  if (pnr.length !== 10) return { success: false, error: 'auth' };
  return fn(pnr);
}

// ── Schema bootstrap (runs on every request, cheap) ─────────────
function ensureSchema(doc) {
  const school = doc.getSheetByName(SCHOOL_SHEET);
  if (!school) {
    const sheets = doc.getSheets().map(function(s) { return s.getName(); }).join(', ');
    throw new Error('Sheet "' + SCHOOL_SHEET + '" not found. Available sheets: ' + sheets);
  }

  const lastCol = school.getLastColumn();
  if (lastCol < 1) {
    throw new Error('Sheet "' + SCHOOL_SHEET + '" is empty — no header row found.');
  }

  // Append the admin columns at the END of the header row so that every
  // existing header index stays stable for the registration backend.
  const headers = school.getRange(1, 1, 1, lastCol).getValues()[0];
  let col = lastCol;
  ['klass', 'Böcker'].forEach(function(h) {
    if (headers.indexOf(h) === -1) {
      col += 1;
      school.getRange(1, col).setValue(h);
    }
  });

  ensureTab(doc, TAB_KLASSER, ['Klass', 'Dag', 'LärarePNR', 'Sortering']);
  ensureTab(doc, TAB_LARARE, ['Namn', 'Personnummer', 'Salt', 'LösenordHash', 'Telefon']);
  ensureTab(doc, TAB_NARVARO, ['Datum', 'Dag', 'Klass', 'BarnetsPersonnummer', 'BarnetsNamn', 'Närvarande']);

  // Older Klasser tabs were created without the color column — append it.
  const klassTab = doc.getSheetByName(TAB_KLASSER);
  const kLastCol = klassTab.getLastColumn();
  if (kLastCol > 0) {
    const kHeaders = klassTab.getRange(1, 1, 1, kLastCol).getValues()[0];
    if (kHeaders.indexOf('Färg') === -1) {
      klassTab.getRange(1, kLastCol + 1).setValue('Färg');
    }
  }
}

function ensureTab(doc, name, headersArr) {
  let tab = doc.getSheetByName(name);
  if (!tab) tab = doc.insertSheet(name);
  if (tab.getLastRow() === 0) {
    tab.getRange(1, 1, 1, headersArr.length).setValues([headersArr]);
  }
}

// ── Actions: login ──────────────────────────────────────────────
function adminLogin(params) {
  const password = getParam(params, 'password');
  const adminPassword = scriptProp.getProperty('ADMIN_PASSWORD');
  if (!adminPassword) {
    return { success: false, error: 'ADMIN_PASSWORD script property is not set.' };
  }
  if (password && password === adminPassword) {
    return { success: true, token: signToken('admin'), role: 'admin' };
  }
  return { success: false, error: 'invalid_password' };
}

function teacherLogin(doc, params) {
  const pnr = normPnr(getParam(params, 'pnr'));
  const password = String(getParam(params, 'password') || '');
  const teacher = readTeachers(doc).find(function(t) { return t.pnr === pnr; });

  if (!teacher || !teacher.hash || hashPassword(teacher.salt, password) !== teacher.hash) {
    return { success: false, error: 'invalid_login' };
  }
  return {
    success: true,
    token: signToken(teacher.pnr),
    role: 'teacher',
    teacher: { name: teacher.name, pnr: teacher.pnr }
  };
}

// ── Actions: admin board ────────────────────────────────────────
function getBoard(doc) {
  return {
    success: true,
    students: readStudents(doc).students,
    today: todayStr(),
    todayDay: todayDayLabel()
  };
}

function updateStudent(doc, params) {
  const row = parseInt(getParam(params, 'row'), 10);
  if (!row || row < 2) return { success: false, error: 'invalid_row' };

  let fields;
  try {
    fields = JSON.parse(getParam(params, 'fields'));
  } catch (e) {
    return { success: false, error: 'invalid_fields' };
  }
  if (!fields || typeof fields !== 'object') return { success: false, error: 'invalid_fields' };

  // Locked fields — the personnummer columns are used by other flows.
  if ('ssn' in fields || 'fatherSsn' in fields || 'motherSsn' in fields) {
    return { success: false, error: 'pnr_locked' };
  }

  const ALLOWED = ['firstName', 'lastName', 'skoldag', 'books', 'payment',
    'fatherName', 'fatherPhone', 'fatherEmail',
    'motherName', 'motherPhone', 'motherEmail',
    'address', 'zip', 'city'];
  const HEADER_OF = {
    firstName: 'Barnet Förnamn', lastName: 'Barnet Efternamn',
    skoldag: 'skoldag', books: 'Böcker', payment: 'Månatligbetalning',
    fatherName: 'Pappans Namn', fatherPhone: 'Pappans Mobilnummer', fatherEmail: 'Pappans Email',
    motherName: 'Mammans Namn', motherPhone: 'Mammans Mobilnummer', motherEmail: 'Mammans Email',
    address: 'Adress', zip: 'Postnummer', city: 'Postort'
  };

  const info = getSchoolInfo(doc);
  const sheet = info.sheet, col = info.col;

  if (!verifyRowSsn(sheet, col, row, getParam(params, 'ssn'))) {
    return { success: false, error: 'row_changed' };
  }

  for (const key of ALLOWED) {
    if (!(key in fields)) continue;
    const colIdx = col[HEADER_OF[key]];
    if (colIdx === -1) continue;

    let value = fields[key];
    if (value === null || value === undefined) value = '';

    if (key === 'books') {
      value = (value === true || value === 'J' || value === 'j' || value === 1 || value === '1' || value === 'TRUE') ? 'J' : '';
    } else if (key === 'payment') {
      const pv = String(value || '').trim().toUpperCase();
      value = (pv === 'S' || pv === 'J') ? 'S' : (pv === 'K' ? 'K' : '');
    } else if (key === 'skoldag') {
      if (value !== 'Lördag' && value !== 'Söndag') return { success: false, error: 'invalid_skoldag' };
    } else {
      value = String(value);
    }

    sheet.getRange(row, colIdx + 1).setValue(value);
  }

  // Recomputed field: "Barnets namn"
  if (('firstName' in fields) || ('lastName' in fields)) {
    const nameCol = col['Barnets namn'];
    if (nameCol !== -1) {
      const fn = ('firstName' in fields)
        ? String(fields.firstName || '').trim()
        : String(sheet.getRange(row, col['Barnet Förnamn'] + 1).getValue() || '').trim();
      const ln = ('lastName' in fields)
        ? String(fields.lastName || '').trim()
        : String(sheet.getRange(row, col['Barnet Efternamn'] + 1).getValue() || '').trim();
      sheet.getRange(row, nameCol + 1).setValue((fn + ' ' + ln).trim());
    }
  }

  return { success: true, student: readStudentAt(sheet, col, row) };
}

function setKlass(doc, params) {
  const row = parseInt(getParam(params, 'row'), 10);
  const klass = getParam(params, 'klass').trim();
  const boardDay = getParam(params, 'boardDay');

  if (!row || row < 2) return { success: false, error: 'invalid_row' };
  // boardDay '' = the combined "all" board: keep the current skoldag.
  if (boardDay !== '' && boardDay !== 'Lördag' && boardDay !== 'Söndag') return { success: false, error: 'invalid_day' };

  const info = getSchoolInfo(doc);
  const sheet = info.sheet, col = info.col;
  if (col['klass'] === -1) return { success: false, error: 'missing_klass_column' };

  if (!verifyRowSsn(sheet, col, row, getParam(params, 'ssn'))) {
    return { success: false, error: 'row_changed' };
  }

  const classes = readClasses(doc);

  if (klass !== '') {
    const cls = classes.find(function(c) { return c.name.toLowerCase() === klass.toLowerCase(); });
    if (!cls) return { success: false, error: 'class_not_found' };
    sheet.getRange(row, col['klass'] + 1).setValue(cls.name);
    sheet.getRange(row, col['skoldag'] + 1).setValue(cls.day);
  } else {
    sheet.getRange(row, col['klass'] + 1).setValue('');
    if (boardDay !== '') {
      sheet.getRange(row, col['skoldag'] + 1).setValue(boardDay);
    }
  }

  return { success: true, student: readStudentAt(sheet, col, row) };
}

function addStudent(doc, params) {
  const firstName = getParam(params, 'firstName').trim();
  const lastName = getParam(params, 'lastName').trim();
  const ssn = normPnr(getParam(params, 'ssn'));
  const skoldag = getParam(params, 'skoldag');
  const flag = function(v) { return (v === 'J' || v === '1' || v === 'true') ? 'J' : ''; };
  const normalizePayment = function(v) {
    const pv = String(v || '').trim().toUpperCase();
    return (pv === 'S' || pv === 'J') ? 'S' : (pv === 'K' ? 'K' : '');
  };

  if (!firstName && !lastName) return { success: false, error: 'missing_name' };
  if (skoldag !== 'Lördag' && skoldag !== 'Söndag') return { success: false, error: 'invalid_skoldag' };

  // Reject duplicates only when a child PNR was provided (it is optional).
  if (ssn && readStudents(doc).students.some(function(s) { return normPnr(s.ssn) === ssn; })) {
    return { success: false, error: 'duplicate_student' };
  }

  const info = getSchoolInfo(doc);
  const sheet = info.sheet, col = info.col;
  const row = new Array(info.headers.length).fill('');

  function put(header, value) {
    const idx = col[header];
    if (idx !== -1) row[idx] = value;
  }

  // New cards start unassigned (klass = '') — the admin drags them to a class.
  put('Barnet Förnamn', firstName);
  put('Barnet Efternamn', lastName);
  put('Barnets Personnummer', ssn);
  put('Barnets namn', (firstName + ' ' + lastName).trim());
  put('skoldag', skoldag);
  put('Böcker', flag(getParam(params, 'books')));
  put('Månatligbetalning', normalizePayment(getParam(params, 'payment')));
  put('Pappans Namn', getParam(params, 'fatherName').trim());
  put('Pappans Personnummer', normPnr(getParam(params, 'fatherSsn')));
  put('Pappans Mobilnummer', getParam(params, 'fatherPhone').trim());
  put('Pappans Email', getParam(params, 'fatherEmail').trim());
  put('Mammans Namn', getParam(params, 'motherName').trim());
  put('Mammans Personnummer', normPnr(getParam(params, 'motherSsn')));
  put('Mammans Mobilnummer', getParam(params, 'motherPhone').trim());
  put('Mammans Email', getParam(params, 'motherEmail').trim());
  put('Adress', getParam(params, 'address').trim());
  put('Postnummer', getParam(params, 'zip').trim());
  put('Postort', getParam(params, 'city').trim());
  put('RegistreringsDatum', Utilities.formatDate(new Date(), 'Europe/Stockholm', 'yyyy-MM-dd HH:mm:ss'));

  sheet.appendRow(row);
  return { success: true, student: readStudentAt(sheet, col, sheet.getLastRow()) };
}

// ── Actions: class management ───────────────────────────────────
function listClasses(doc) {
  return { success: true, classes: cleanClasses(readClasses(doc)) };
}

function addClass(doc, params) {
  const name = getParam(params, 'name').trim();
  const day = getParam(params, 'day');
  const teacherPnr = normPnr(getParam(params, 'teacherPnr'));
  const color = getParam(params, 'color').trim();

  if (!name) return { success: false, error: 'missing_name' };
  if (day !== 'Lördag' && day !== 'Söndag') return { success: false, error: 'invalid_day' };
  if (color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) return { success: false, error: 'invalid_color' };

  const classes = readClasses(doc);
  if (classes.some(function(c) { return c.name.toLowerCase() === name.toLowerCase(); })) {
    return { success: false, error: 'duplicate_class' };
  }

  const maxSort = classes.reduce(function(m, c) { return Math.max(m, c.sort); }, 0);
  doc.getSheetByName(TAB_KLASSER).appendRow([name, day, teacherPnr, maxSort + 1, color]);

  return { success: true, classes: cleanClasses(readClasses(doc)) };
}

function renameClass(doc, params) {
  const oldName = getParam(params, 'oldName').trim();
  const newName = getParam(params, 'newName').trim();
  if (!oldName || !newName) return { success: false, error: 'missing_name' };

  const classes = readClasses(doc);
  const cls = classes.find(function(c) { return c.name.toLowerCase() === oldName.toLowerCase(); });
  if (!cls) return { success: false, error: 'class_not_found' };
  if (newName.toLowerCase() !== oldName.toLowerCase() &&
      classes.some(function(c) { return c.name.toLowerCase() === newName.toLowerCase(); })) {
    return { success: false, error: 'duplicate_class' };
  }

  doc.getSheetByName(TAB_KLASSER).getRange(cls.sheetRow, 1).setValue(newName);

  // Rewrite every student row carrying the old class name.
  const info = getSchoolInfo(doc);
  const sheet = info.sheet, col = info.col;
  const data = readStudentRows(sheet);
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][col['klass']] || '').trim() === oldName) {
      sheet.getRange(i + 2, col['klass'] + 1).setValue(newName);
    }
  }

  return { success: true, classes: cleanClasses(readClasses(doc)) };
}

function deleteClass(doc, params) {
  const name = getParam(params, 'name').trim();
  const classes = readClasses(doc);
  const cls = classes.find(function(c) { return c.name.toLowerCase() === name.toLowerCase(); });
  if (!cls) return { success: false, error: 'class_not_found' };

  doc.getSheetByName(TAB_KLASSER).deleteRow(cls.sheetRow);

  // Students return to "new students" (klass = ''); skoldag is preserved
  // so they reappear on the correct board. Närvaro history is untouched.
  const info = getSchoolInfo(doc);
  const sheet = info.sheet, col = info.col;
  const data = readStudentRows(sheet);
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][col['klass']] || '').trim() === name) {
      sheet.getRange(i + 2, col['klass'] + 1).setValue('');
    }
  }

  return { success: true, classes: cleanClasses(readClasses(doc)) };
}

function updateClass(doc, params) {
  const name = getParam(params, 'name').trim();
  const teacherPnr = normPnr(getParam(params, 'teacherPnr'));
  const classes = readClasses(doc);
  const cls = classes.find(function(c) { return c.name.toLowerCase() === name.toLowerCase(); });
  if (!cls) return { success: false, error: 'class_not_found' };

  const tab = doc.getSheetByName(TAB_KLASSER);
  tab.getRange(cls.sheetRow, 3).setValue(teacherPnr);

  // Color is optional in the API — only written when the param is present.
  if (Object.prototype.hasOwnProperty.call(params, 'color')) {
    const color = getParam(params, 'color').trim();
    if (color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) return { success: false, error: 'invalid_color' };
    tab.getRange(cls.sheetRow, 5).setValue(color);
  }

  return { success: true, classes: cleanClasses(readClasses(doc)) };
}

// ── Actions: teacher management ─────────────────────────────────
function listTeachers(doc) {
  return { success: true, teachers: cleanTeachers(readTeachers(doc)) };
}

function addTeacher(doc, params) {
  const name = getParam(params, 'name').trim();
  const pnr = normPnr(getParam(params, 'pnr'));
  const phone = getParam(params, 'phone').trim();
  const password = String(getParam(params, 'password') || '');

  if (!name) return { success: false, error: 'missing_name' };
  if (pnr.length !== 10) return { success: false, error: 'invalid_pnr' };
  if (password.length < 6) return { success: false, error: 'weak_password' };
  if (readTeachers(doc).some(function(t) { return t.pnr === pnr; })) {
    return { success: false, error: 'duplicate_teacher' };
  }

  const salt = genSalt();
  doc.getSheetByName(TAB_LARARE).appendRow([name, pnr, salt, hashPassword(salt, password), phone]);

  return { success: true, teachers: cleanTeachers(readTeachers(doc)) };
}

function updateTeacher(doc, params) {
  const pnr = normPnr(getParam(params, 'pnr'));
  const name = getParam(params, 'name').trim();
  const phone = getParam(params, 'phone').trim();
  const teacher = readTeachers(doc).find(function(t) { return t.pnr === pnr; });
  if (!teacher) return { success: false, error: 'teacher_not_found' };
  if (!name) return { success: false, error: 'missing_name' };

  const tab = doc.getSheetByName(TAB_LARARE);
  tab.getRange(teacher.sheetRow, 1).setValue(name);
  tab.getRange(teacher.sheetRow, 5).setValue(phone);

  return { success: true, teachers: cleanTeachers(readTeachers(doc)) };
}

function deleteTeacher(doc, params) {
  const pnr = normPnr(getParam(params, 'pnr'));
  const teacher = readTeachers(doc).find(function(t) { return t.pnr === pnr; });
  if (!teacher) return { success: false, error: 'teacher_not_found' };

  doc.getSheetByName(TAB_LARARE).deleteRow(teacher.sheetRow);

  // Unassign from any class.
  const tab = doc.getSheetByName(TAB_KLASSER);
  const lastRow = tab.getLastRow();
  if (lastRow > 1) {
    const data = tab.getRange(2, 3, lastRow - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (normPnr(String(data[i][0] || '')) === pnr) {
        tab.getRange(i + 2, 3).setValue('');
      }
    }
  }

  return { success: true, teachers: cleanTeachers(readTeachers(doc)) };
}

function resetTeacherPassword(doc, params) {
  const pnr = normPnr(getParam(params, 'pnr'));
  const newPassword = String(getParam(params, 'newPassword') || '');
  const teacher = readTeachers(doc).find(function(t) { return t.pnr === pnr; });
  if (!teacher) return { success: false, error: 'teacher_not_found' };
  if (newPassword.length < 6) return { success: false, error: 'weak_password' };

  const salt = genSalt();
  const tab = doc.getSheetByName(TAB_LARARE);
  tab.getRange(teacher.sheetRow, 3).setValue(salt);
  tab.getRange(teacher.sheetRow, 4).setValue(hashPassword(salt, newPassword));

  return { success: true };
}

// ── Actions: teacher board + attendance ─────────────────────────
function teacherBoard(doc, pnr) {
  const teacher = readTeachers(doc).find(function(t) { return t.pnr === pnr; });
  if (!teacher) return { success: false, error: 'auth' };

  const classes = readClasses(doc).filter(function(c) { return c.teacherPnr === pnr; });
  const students = readStudents(doc).students;
  const today = todayStr();
  const todayDay = todayDayLabel();
  const narvaro = readNarvaro(doc);

  const outClasses = classes.map(function(c) {
    const kids = students
      .filter(function(s) { return s.klass === c.name; })
      .map(function(s) {
        return {
          // Normalized so it matches the attendance map keys below.
          pnr: normPnr(s.ssn), name: s.name, books: s.books,
          fatherPhone: s.fatherPhone, motherPhone: s.motherPhone,
          address: s.address, zip: s.zip, city: s.city
        };
      });
    kids.sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', 'ar'); });

    // Two sessions per class: last week's class-day and this week's.
    const s = sessionDates(c.day);
    const sessions = [
      { date: s.lastWeek, isToday: s.lastWeek === today },
      { date: s.thisWeek, isToday: s.thisWeek === today }
    ];
    const attendance = {};
    sessions.forEach(function(se) {
      const map = {};
      narvaro.filter(function(n) { return n.klass === c.name && n.date === se.date; })
        .forEach(function(n) { map[n.pnr] = n.present; });
      attendance[se.date] = map;
    });

    return { name: c.name, day: c.day, sessions: sessions, attendance: attendance, students: kids };
  });

  return {
    success: true,
    teacher: { name: teacher.name, pnr: teacher.pnr },
    today: today,
    todayDay: todayDay,
    classes: outClasses
  };
}

function markAttendance(doc, teacherPnr, params) {
  const klassName = getParam(params, 'klass').trim();
  const childPnr = normPnr(getParam(params, 'pnr'));
  const date = getParam(params, 'date').trim();
  const presentRaw = getParam(params, 'present');
  const present = (presentRaw === 'J' || presentRaw === '1' || presentRaw === 'true') ? 'J' : 'N';

  const cls = readClasses(doc).find(function(c) { return c.name === klassName; });
  if (!cls) return { success: false, error: 'class_not_found' };
  if (cls.teacherPnr !== teacherPnr) return { success: false, error: 'forbidden' };

  // Flexible attendance: allowed for this week's or last week's class-day
  // (the two sessions shown in the teacher view). Server-authoritative.
  const s = sessionDates(cls.day);
  if (date !== s.thisWeek && date !== s.lastWeek) {
    return { success: false, error: 'invalid_date' };
  }

  const student = readStudents(doc).students.find(function(s) {
    return normPnr(s.ssn) === childPnr && s.klass === cls.name;
  });
  if (!student) return { success: false, error: 'student_not_found' };

  const existing = readNarvaro(doc).find(function(n) {
    return n.date === date && n.klass === cls.name && n.pnr === childPnr;
  });

  const tab = doc.getSheetByName(TAB_NARVARO);
  if (existing) {
    tab.getRange(existing.sheetRow, 6).setValue(present);
  } else {
    tab.appendRow([date, cls.day, cls.name, childPnr, student.name, present]);
  }

  return { success: true, present: present, date: date };
}

// ── Sheet readers ───────────────────────────────────────────────
function getSchoolInfo(doc) {
  const sheet = doc.getSheetByName(SCHOOL_SHEET);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  HEADER_FIELDS.forEach(function(h) { col[h] = headers.indexOf(h); });
  return { sheet: sheet, col: col, headers: headers };
}

function readStudentRows(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  return lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
}

function readStudents(doc) {
  const info = getSchoolInfo(doc);
  const data = readStudentRows(info.sheet);
  const students = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const isEmpty = row.every(function(v) { return v === '' || v === null || v === undefined; });
    if (isEmpty) continue;
    students.push(rowToStudent(i + 2, row, info.col));
  }
  return { students: students, col: info.col, sheet: info.sheet };
}

function rowToStudent(rowNum, row, col) {
  function g(h) {
    if (col[h] === -1) return '';
    const v = row[col[h]];
    if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Stockholm', 'yyyy-MM-dd HH:mm:ss');
    return String(v || '').trim();
  }
  function isFlag(h) {
    if (col[h] === -1) return '';
    const v = row[col[h]];
    if (v === true || v === 'J' || v === 'j' || String(v).toUpperCase() === 'TRUE') return 'J';
    return '';
  }
  // Payment method: S = Swish, K = cash, '' = none.
  // Legacy 'J' (paid via the old Stripe flow) maps to S — it means "paid".
  function paymentValue() {
    if (col['Månatligbetalning'] === -1) return '';
    const v = String(row[col['Månatligbetalning']] || '').trim().toUpperCase();
    if (v === 'S' || v === 'J') return 'S';
    if (v === 'K') return 'K';
    return '';
  }
  return {
    row: rowNum,
    ssn: g('Barnets Personnummer'),
    firstName: g('Barnet Förnamn'),
    lastName: g('Barnet Efternamn'),
    name: g('Barnets namn'),
    skoldag: g('skoldag'),
    klass: g('klass'),
    books: isFlag('Böcker'),
    payment: paymentValue(),
    fatherName: g('Pappans Namn'),
    fatherSsn: g('Pappans Personnummer'),
    fatherPhone: g('Pappans Mobilnummer'),
    fatherEmail: g('Pappans Email'),
    motherName: g('Mammans Namn'),
    motherSsn: g('Mammans Personnummer'),
    motherPhone: g('Mammans Mobilnummer'),
    motherEmail: g('Mammans Email'),
    address: g('Adress'),
    zip: g('Postnummer'),
    city: g('Postort'),
    registered: g('RegistreringsDatum')
  };
}

function readStudentAt(sheet, col, row) {
  const lastCol = sheet.getLastColumn();
  return rowToStudent(row, sheet.getRange(row, 1, 1, lastCol).getValues()[0], col);
}

function verifyRowSsn(sheet, col, row, expectedSsn) {
  const lastRow = sheet.getLastRow();
  if (row < 2 || row > lastRow) return false;
  // Normalize both sides: the sheet may hold 10- or 12-digit PNRs.
  const actual = normPnr(String(sheet.getRange(row, col['Barnets Personnummer'] + 1).getValue() || ''));
  return actual === normPnr(expectedSsn);
}

function readClasses(doc) {
  const tab = doc.getSheetByName(TAB_KLASSER);
  const lastRow = tab.getLastRow();
  const data = lastRow > 1 ? tab.getRange(2, 1, lastRow - 1, 5).getValues() : [];
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const name = String(r[0] || '').trim();
    if (!name) continue;
    out.push({
      name: name,
      day: String(r[1] || '').trim(),
      teacherPnr: normPnr(String(r[2] || '')),
      sort: parseInt(r[3], 10) || 0,
      color: String(r[4] || '').trim(),
      sheetRow: i + 2
    });
  }
  out.sort(function(a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name); });
  return out;
}

function cleanClasses(classes) {
  return classes.map(function(c) {
    return { name: c.name, day: c.day, teacherPnr: c.teacherPnr, sort: c.sort, color: c.color };
  });
}

function readTeachers(doc) {
  const tab = doc.getSheetByName(TAB_LARARE);
  const lastRow = tab.getLastRow();
  const data = lastRow > 1 ? tab.getRange(2, 1, lastRow - 1, 5).getValues() : [];
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const pnr = normPnr(String(r[1] || ''));
    if (!pnr) continue;
    out.push({
      name: String(r[0] || '').trim(),
      pnr: pnr,
      phone: String(r[4] || '').trim(),
      salt: String(r[2] || ''),
      hash: String(r[3] || ''),
      sheetRow: i + 2
    });
  }
  return out;
}

// Never expose salt/hash to the client.
function cleanTeachers(teachers) {
  return teachers.map(function(t) {
    return { name: t.name, pnr: t.pnr, phone: t.phone };
  });
}

function readNarvaro(doc) {
  const tab = doc.getSheetByName(TAB_NARVARO);
  const lastRow = tab.getLastRow();
  const data = lastRow > 1 ? tab.getRange(2, 1, lastRow - 1, 6).getValues() : [];
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    out.push({
      date: String(r[0] || ''),
      day: String(r[1] || '').trim(),
      klass: String(r[2] || '').trim(),
      pnr: normPnr(String(r[3] || '')),
      name: String(r[4] || '').trim(),
      present: String(r[5] || '').trim() === 'J' ? 'J' : 'N',
      sheetRow: i + 2
    });
  }
  return out;
}

// ── Tokens ──────────────────────────────────────────────────────
function signToken(subject, ttlMs) {
  const expiryMs = Date.now() + (ttlMs || TOKEN_TTL_MS);
  const payload = subject + '.' + expiryMs;
  return payload + '.' + hmacHex(payload);
}

function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const subject = parts[0], expiryMs = parts[1], sig = parts[2];
  if (!/^\d+$/.test(expiryMs)) return null;
  if (Number(expiryMs) < Date.now()) return null;
  try {
    if (!safeEqualsHex(sig, hmacHex(subject + '.' + expiryMs))) return null;
  } catch (e) {
    return null;
  }
  return { subject: subject };
}

function hmacHex(message) {
  const secret = scriptProp.getProperty('TOKEN_SECRET');
  if (!secret) throw new Error('Script property "TOKEN_SECRET" is not set.');
  return bytesToHex(
    Utilities.computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8)
  );
}

function safeEqualsHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Teacher passwords (GAS has no bcrypt; salted iterated SHA-256) ──
function genSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword(salt, password) {
  let h = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8
  );
  for (let i = 1; i < 5000; i++) {
    // Note: no Charset argument here — the (algorithm, value, charset)
    // overload only accepts a string, not a byte array.
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h);
  }
  return bytesToHex(h);
}

// ── Helpers ─────────────────────────────────────────────────────
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeParams(raw) {
  const out = {};
  Object.keys(raw).forEach(function(k) { out[k.replace(/\[\]$/, '')] = raw[k]; });
  return out;
}

function getParam(params, name) {
  const v = params[name];
  return Array.isArray(v) ? v[0] : (v || '');
}

function normPnr(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  if (d.length === 12 && (d.indexOf('19') === 0 || d.indexOf('20') === 0)) return d.substring(2);
  return d;
}

function bytesToHex(bytes) {
  return bytes.map(function(b) {
    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function todayStr() {
  return Utilities.formatDate(new Date(), 'Europe/Stockholm', 'yyyy-MM-dd');
}

// Timezone-safe weekday: derive from the Stockholm-formatted date
// instead of getDay() (which uses the script's own timezone).
function todayDayLabel() {
  const eee = Utilities.formatDate(new Date(), 'Europe/Stockholm', 'EEE');
  if (eee === 'Sat') return 'Lördag';
  if (eee === 'Sun') return 'Söndag';
  return '';
}

// Day-of-week of a "yyyy-MM-dd" string (0 = Sunday .. 6 = Saturday).
// Computed from the date components only — independent of any timezone.
function dowOfDateStr(dateStr) {
  const p = String(dateStr).split('-');
  let y = parseInt(p[0], 10);
  const m = parseInt(p[1], 10);
  const d = parseInt(p[2], 10);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  y -= (m < 3) ? 1 : 0;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7;
}

// Date arithmetic on "yyyy-MM-dd" strings. Constructed at noon so that
// any timezone offset between the script tz and Stockholm keeps the
// same calendar day.
function addDaysToDateStr(dateStr, days) {
  const p = String(dateStr).split('-');
  const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + days, 12, 0, 0);
  return Utilities.formatDate(d, 'Europe/Stockholm', 'yyyy-MM-dd');
}

// The two attendance sessions shown to a teacher: last week's class-day
// and this week's class-day.
function sessionDates(day) {
  const today = todayStr();
  const classDow = day === 'Lördag' ? 6 : 0;
  const todayDow = dowOfDateStr(today);
  const thisWeek = addDaysToDateStr(today, classDow - todayDow);
  const lastWeek = addDaysToDateStr(thisWeek, -7);
  return { thisWeek: thisWeek, lastWeek: lastWeek };
}
