/**
 * Google Apps Script — Marriage Request & Contract Upload
 *
 * Handles four actions:
 *   action=submit-request  — Initial request with 4 documents + form fields
 *   action=confirm          — Mosque confirms the time (creates calendar event + sends payment link)
 *   action=submit-contract  — Final marriage contract PDF upload (with versioning)
 *   action=email-contract   — Email a copy of the contract to the couple
 *
 * Folder structure: Marriage Requests / YYYY / MM / personnummer
 *
 * DEPLOYMENT:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into Code.gs
 * 3. Click Deploy → New Deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the deployment URL and paste it into marriage/index.html as GAS_URL
 */

// ── Configuration ────────────────────────────────────────────────

function getMemberDiscountCode() {
  return PropertiesService.getScriptProperties().getProperty('MEMBER_DISCOUNT_CODE') || '';
}
var ROOT_FOLDER_ID = '19k773mFMvLlQRswYWgKL2bghyNI4IZLe';

// ── Main entry points ──────────────────────────────────────────

function doPost(e) {
  try {
    const action = e.parameter.action || 'submit-contract';

    if (action === 'submit-request') {
      return handleSubmitRequest(e);
    }
    if (action === 'email-contract') {
      return handleEmailContract(e);
    }
    return handleSubmitContract(e);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  const action = e.parameter.action || '';

  if (action === 'confirm') {
    return handleConfirm(e);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Action: submit-request (initial document upload) ────────────

function handleSubmitRequest(e) {
  const email         = (e.parameter.email         || '').trim();
  const phone         = (e.parameter.phone         || '').trim();
  const notes         = (e.parameter.notes         || '').trim();
  const preferredDate = (e.parameter.preferredDate || '').trim();
  const preferredTime = (e.parameter.preferredTime || '').trim();
  const husbandPnr    = (e.parameter.husbandPnr    || '').trim();
  const isMember      = (e.parameter.isMember      || '').trim();

  if (!email || !phone || !husbandPnr) {
    return jsonResponse({ success: false, error: 'Missing required fields: email, phone, husbandPnr' });
  }

  // Build folder structure: Marriage Requests / YYYY / MM / personnummer
  const pnrClean = husbandPnr.replace(/[^0-9]/g, '');
  const now = new Date();
  const yearStr  = String(now.getFullYear());
  const monthStr = String(now.getMonth() + 1).padStart(2, '0');

  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const yearFolder = getOrCreateFolder(rootFolder, yearStr);
  const monthFolder = getOrCreateFolder(yearFolder, monthStr);
  const coupleFolder = getOrCreateFolder(monthFolder, pnrClean);

  // Save uploaded documents
  const docDefs = [
    { param: 'wifeIdDoc',     filename: 'Brud-ID' },
    { param: 'husbandIdDoc',  filename: 'Brudgum-ID' },
    { param: 'wifeFolkDoc',   filename: 'Brud-Folkbokforingsbevis' },
    { param: 'husbandFolkDoc', filename: 'Brudgum-Folkbokforingsbevis' }
  ];

  docDefs.forEach(function(def) {
    const data = e.parameter[def.param];
    if (data) {
      try {
        const blob = Utilities.newBlob(
          Utilities.base64Decode(data.split(',')[1] || data),
          e.parameter[def.param + 'Mime'] || 'application/octet-stream',
          def.filename
        );
        const file = coupleFolder.createFile(blob);
        file.setDescription('Uploaded on ' + now.toISOString());
      } catch (ex) {
        // Silently continue
      }
    }
  });

  // Build WhatsApp link
  const phoneDigits = phone.replace(/\D/g, '');
  let whatsappLine = '';
  if (phoneDigits) {
    const waNumber = phoneDigits.replace(/^0+/, '46');
    whatsappLine = 'WhatsApp: https://wa.me/' + waNumber;
  }

  // Build Bekräfta link (URL-encode params for safety)
  const confirmParams = 'action=confirm'
    + '&email=' + encodeURIComponent(email)
    + '&preferredDate=' + encodeURIComponent(preferredDate)
    + '&preferredTime=' + encodeURIComponent(preferredTime)
    + '&personnummer=' + encodeURIComponent(husbandPnr)
    + '&isMember=' + encodeURIComponent(isMember);
  const gasUrl = (e.parameter.gasUrl || '').trim();
  const confirmUrl = gasUrl + '?' + confirmParams;

  // ── Email to mosque ────────────────────────────
  const mosqueSubject = 'Ny vigselförfrågan - ' + husbandPnr;
  const mosqueBody = [
    'En ny vigselförfrågan har skickats in:',
    '',
    'Personnummer (make): ' + husbandPnr,
    'Email:    ' + email,
    'Telefon:  ' + (phone || '---'),
    'Medlem:   ' + (isMember === 'true' ? 'Ja' : 'Nej'),
    'Önskat datum: ' + (preferredDate || '---'),
    'Önskad tid:   ' + (preferredTime || 'Valfri tid')
  ];

  if (notes) {
    mosqueBody.push('Önskemål:  ' + notes);
  }

  mosqueBody.push('');
  mosqueBody.push('Dokument: ' + coupleFolder.getUrl());

  if (whatsappLine) {
    mosqueBody.push(whatsappLine);
  }

  mosqueBody.push('');
  mosqueBody.push('--------------------------------------------------------------');
  mosqueBody.push('Klicka på länken nedan för att bekräfta tiden.');
  mosqueBody.push('');
  mosqueBody.push(confirmUrl);
  mosqueBody.push('');
  mosqueBody.push('Därefter kan paret fylla i äktenskapskontraktet på:');
  mosqueBody.push('https://alsalamcenter.se/marriage/?step=2');

  GmailApp.sendEmail('info@alsalamcenter.se', mosqueSubject, mosqueBody.join('\n'), {
    name: 'Al-Salam Moské - Vigsel'
  });

  // ── Confirmation email to user ─────────────────
  var dateStr = preferredDate || '---';
  if (preferredTime) dateStr += ' kl. ' + preferredTime;

  const userSubject = 'Vigselförfrågan mottagen - Al-Salam Moské';
  const userBody = [
    'Salam alaykom!',
    '',
    'Vi har mottagit er förfrågan om vigsel (personnummer: ' + husbandPnr + ').',
    '',
    'Nästa steg:',
    '',
    '1. Moskén granskar er bokningsförfrågan och era dokument. När allt är godkänt får ni ett bekräftelsemejl med den bokade tiden (' + dateStr + '). Kontrollera även skräpposten.',
    '',
    '2. I bekräftelsemejlet finns en betalningslänk. Avgiften är 1 200 kr.',
    '',
    '3. Efter betalningen fyller ni i äktenskapsformuläret digitalt och skickar det till moskén.',
    '',
    'Vid frågor, kontakta oss på info@alsalamcenter.se.',
    '',
    'Detta är ett automatiskt mejl. Vänligen svara inte på det.',
    '',
    'Må Allah välsigna er,',
    'Al-Salam Moské'
  ].join('\n');

  GmailApp.sendEmail(email, userSubject, userBody, {
    name: 'Al-Salam Moské'
  });

  return jsonResponse({ success: true, folderUrl: coupleFolder.getUrl() });
}

// ── Action: confirm (mosque clicks Bekräfta link) ────────────────

function handleConfirm(e) {
  const email         = (e.parameter.email         || '').trim();
  const preferredDate = (e.parameter.preferredDate || '').trim();
  const preferredTime = (e.parameter.preferredTime || '12:00').trim();
  const personnummer  = (e.parameter.personnummer  || '').trim();
  const isMember      = (e.parameter.isMember      || '').trim();

  if (!email || !preferredDate || !personnummer) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;">' +
      '<h2 style="color:#dc3545;">Saknad information</h2>' +
      '<p>Länken är ofullständig. Kontrollera att alla parametrar finns.</p>' +
      '</body></html>'
    );
  }

  // Parse date + time and create calendar event (2 hours)
  const startTime = new Date(preferredDate + 'T' + preferredTime + ':00');
  if (isNaN(startTime.getTime())) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;">' +
      '<h2 style="color:#dc3545;">Ogiltigt datum/tid</h2>' +
      '<p>Datum: ' + preferredDate + ', Tid: ' + preferredTime + '</p>' +
      '</body></html>'
    );
  }
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

  let calendarLink = '';
  let calendarError = '';
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const event = cal.createEvent(
      'Vigsel: ' + personnummer,
      startTime,
      endTime,
      {
        description: 'Personnummer: ' + personnummer + '\nEmail: ' + email + '\nDatum: ' + preferredDate + '\nTid: ' + preferredTime
      }
    );
    var eventId = event.getId().replace('@google.com', '');
    calendarLink = 'https://calendar.google.com/calendar/event?eid=' + encodeURIComponent(eventId);
  } catch (ex) {
    calendarError = ex.toString();
  }

  // Build Stripe URL with prefilled params
  const pnrClean = personnummer.replace(/[^0-9]/g, '');
  var stripeUrl = 'https://buy.stripe.com/5kQdR93Nl2Jy6Vd5oEfw407';
  if (email || pnrClean) {
    var stripeParams = [];
    if (email) stripeParams.push('prefilled_email=' + encodeURIComponent(email));
    if (pnrClean) stripeParams.push('client_reference_id=' + encodeURIComponent(pnrClean));
    stripeUrl += '?' + stripeParams.join('&');
  }

  // ── Send payment email to user ─────────────────
  const paymentSubject = 'Vigseltid bekräftad - Al-Salam Moské';
  var paymentBody = [
    'Salam alaykom,',
    '',
    'Er önskade tid för vigselceremonin har blivit bekräftad: ' + preferredDate + ' kl. ' + preferredTime + '.',
    '',
    'Nästa steg är att betala avgiften via länken nedan:',
    stripeUrl
  ];

  // If member, add discount info
  if (isMember === 'true') {
    paymentBody.push('');
    paymentBody.push('--------------------------------------------------------------');
    paymentBody.push('Eftersom du är medlem i FIFS får du rabatt!');
    var discountCode = getMemberDiscountCode();
    if (discountCode) paymentBody.push('Använd rabattkoden: ' + discountCode);
    paymentBody.push('Klicka på "Lägg till kampanjkod" i kassan för att tillämpa rabatten.');
    paymentBody.push('--------------------------------------------------------------');
  }

  paymentBody.push('');
  paymentBody.push('Efter betalning kan ni fylla i och skicka äktenskapsformuläret digitalt:');
  paymentBody.push('https://alsalamcenter.se/marriage/?step=2');
  paymentBody.push('');
  paymentBody.push('Vid frågor, kontakta oss på info@alsalamcenter.se. Detta är ett automatiskt utskick och går inte att svara på.');
  paymentBody.push('');
  paymentBody.push('Må Allah välsigna er,');
  paymentBody.push('Al-Salam Moské');
  paymentBody.push('https://alsalamcenter.se');

  GmailApp.sendEmail(email, paymentSubject, paymentBody.join('\n'), {
    name: 'Al-Salam Moské'
  });

  var html = '<html><body style="font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;">';
  if (calendarError) {
    html += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin-bottom:24px;">';
    html += '<strong style="color:#856404;">Varning: Kalenderhändelse kunde inte skapas</strong><br>';
    html += '<small style="color:#856404;">Fel: ' + calendarError + '</small><br>';
    html += '<small style="color:#856404;">Kontrollera att skriptet har kalenderbehörighet.</small>';
    html += '</div>';
  }
  html += '<h2 style="color:#198754;">Tiden har bekräftats!</h2>';
  if (!calendarError) {
    html += '<p>Ett kalenderhändelse har skapats för <strong>' + preferredDate + ' kl. ' + preferredTime + '</strong> (2 timmar).</p>';
  }
  html += '<p>E-post med betalningslänk har skickats till <strong>' + email + '</strong>.</p>';
  if (isMember === 'true') {
    var discountCode = getMemberDiscountCode();
    if (discountCode) html += '<p style="color:#198754;">🎉 Medlemsrabatt (' + discountCode + ') har inkluderats i mejlet.</p>';
  }
  if (calendarLink) {
    html += '<p><a href="' + calendarLink + '">Öppna i Google Kalender</a></p>';
  }
  html += '</body></html>';

  return HtmlService.createHtmlOutput(html);
}

// ── Action: submit-contract (PDF upload with versioning) ────────

function handleSubmitContract(e) {
  const wifeName    = (e.parameter.wifeName    || '').trim();
  const husbandName = (e.parameter.husbandName  || '').trim();
  const date        = (e.parameter.date         || '').trim();
  const husbandPnr  = (e.parameter.husbandPnr   || '').trim();

  if (!husbandPnr) {
    return jsonResponse({ success: false, error: 'Missing husbandPnr' });
  }

  const pnrClean = husbandPnr.replace(/[^0-9]/g, '');

  // Search for folder by personnummer
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const coupleFolder = findFolderByPnr(rootFolder, pnrClean);
  const targetFolder = coupleFolder || rootFolder;

  // Versioning: find next version number
  const files = targetFolder.getFiles();
  var highestVersion = 0;
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    const match = name.match(/islamic-marriage-contract(?:-v(\d+))?\.pdf/);
    if (match) {
      const v = match[1] ? parseInt(match[1], 10) : 1;
      if (v > highestVersion) highestVersion = v;
    }
  }
  const newVersion = highestVersion + 1;
  const newFileName = newVersion === 1
    ? 'islamic-marriage-contract.pdf'
    : 'islamic-marriage-contract-v' + newVersion + '.pdf';

  // Create file
  const blob = Utilities.newBlob(
    Utilities.base64Decode(e.parameter.pdf),
    'application/pdf',
    newFileName
  );
  const file = targetFolder.createFile(blob);
  file.setDescription('Version ' + newVersion + ' - ' + wifeName + ' & ' + husbandName + ' - ' + date);

  return jsonResponse({
    success: true,
    version: newVersion,
    fileName: newFileName,
    folderUrl: targetFolder.getUrl()
  });
}

// ── Action: email-contract (send regenerated PDF directly to user) ─

function handleEmailContract(e) {
  const email = (e.parameter.email || '').trim();
  const pdf   = e.parameter.pdf;

  if (!email || !pdf) {
    return jsonResponse({ success: false, error: 'Missing email or pdf' });
  }

  const blob = Utilities.newBlob(
    Utilities.base64Decode(pdf),
    'application/pdf',
    'islamic-marriage-contract.pdf'
  );

  GmailApp.sendEmail(email,
    'Kopia av äktenskapskontrakt - Al-Salam Moské',
    'Salam alaykom,\n\nHär är en kopia av ert äktenskapskontrakt.\n\nMå Allah välsigna er,\nAl-Salam Moské',
    {
      attachments: [blob],
      name: 'Al-Salam Moské'
    }
  );

  return jsonResponse({ success: true });
}

// ── Helpers ───────────────────────────────────────────────────

function findFolderByPnr(rootFolder, pnrClean) {
  const yearFolders = rootFolder.getFolders();
  while (yearFolders.hasNext()) {
    const yearF = yearFolders.next();
    const monthFolders = yearF.getFolders();
    while (monthFolders.hasNext()) {
      const monthF = monthFolders.next();
      const pnrFolders = monthF.getFolders();
      while (pnrFolders.hasNext()) {
        const pnrF = pnrFolders.next();
        if (pnrF.getName() === pnrClean) {
          return pnrF;
        }
      }
    }
  }
  return null;
}

function getOrCreateFolder(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
