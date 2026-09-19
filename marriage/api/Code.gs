/**
 * Google Apps Script — Marriage Request & Contract Upload
 *
 * Handles five actions:
 *   action=submit-request  — Initial request with 4 documents + form fields (POST).
 *                            Requires both husband & wife PNRs; both must be FIFS
 *                            members (verified client-side before submission).
 *   action=confirm          — Shows editable form for imam to confirm time (GET)
 *   action=confirm-submit   — Imam submits the confirmed time (POST). Sends the
 *                            acceptance email with a link to the contract form
 *                            (?step=2 with both PNRs prefilled). No payment.
 *   action=submit-contract  — Final marriage contract PDF upload with versioning (POST)
 *   action=email-contract   — Email a copy of the contract to the couple (POST)
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
 *
 * To UPDATE the existing deployment after code changes (the URL stays the same,
 * so the links already sent out in emails keep working):
 *   1. Replace the whole Code.gs content with this file and Save.
 *   2. Deploy → Manage deployments → ✎ (edit the web app deployment) →
 *      Version: New version → Deploy. (Do NOT create a new deployment — that
 *      would change the URL.)
 *   3. Verify: open <url>?action=version — it must return "marriage Code.gs version 10".
 *      Also open <url>?action=imam-contract&wifeName=Test&husbandName=Test and
 *      check that the page source contains "imam-contract.js" and "imam-contract v2".
 *      If they are missing, the deployment still runs an old version of the code.
 *      <url>?action=debug prints the running function's source length and the
 *      generated page's head/tail — useful for pinpointing a stale deployment.
 *      NOTE: the page's script lives in marriage/js/imam-contract.js (served by
 *      the website). The GAS HtmlService sandbox corrupts INLINE scripts, so the
 *      page only links the script externally. ContentService HTML is not usable
 *      either — Google serves it as application/binary (won't render).
 */

// ── Configuration ────────────────────────────────────────────────

function getMarriageSheetId() {
  return PropertiesService.getScriptProperties().getProperty('MARRIAGE_SHEET_ID') || '';
}
var ROOT_FOLDER_ID = '19k773mFMvLlQRswYWgKL2bghyNI4IZLe';

// Bump this on every change to this file and verify after redeploying:
// open <url>?action=version — it must return the new version number.
var CODE_VERSION = '11';

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
    if (action === 'confirm-submit') {
      return handleConfirmSubmit(e);
    }
    if (action === 'submit-step2') {
      return handleSubmitStep2(e);
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
  if (action === 'imam-contract') {
    return handleImamContract(e);
  }
  if (action === 'version') {
    return ContentService.createTextOutput('marriage Code.gs version ' + CODE_VERSION)
      .setMimeType(ContentService.MimeType.TEXT);
  }
  if (action === 'debug') {
    // Reports which code is actually running in this deployment:
    // function source length + head/tail of the generated imam page.
    var dbgHtml = '';
    try {
      dbgHtml = handleImamContract({ parameter: {} }).getContent();
    } catch (err) {
      dbgHtml = 'ERROR: ' + err.toString();
    }
    var fnSrc = handleImamContract.toString();
    var p = fnSrc.indexOf('pdfOptions');
    return ContentService.createTextOutput(
      'v=' + CODE_VERSION
      + ' | fnLen=' + fnSrc.length
      + ' | sigCount=' + (fnSrc.split('setupSigPad').length - 1)
      + ' | htmlLen=' + dbgHtml.length
      + ' | srcAround=' + fnSrc.substring(Math.max(0, p - 60), p + 400)
      + ' | srcTail=' + fnSrc.substring(Math.max(0, fnSrc.length - 250))
      + ' | htmlTail=' + dbgHtml.substring(Math.max(0, dbgHtml.length - 200))
    ).setMimeType(ContentService.MimeType.TEXT);
  }

  if (action === 'testhtml') {
    // Bisect which content makes the IFRAME sandbox mangle the HTML.
    var cases = [
      ['simple', '<b>a</b><i>end</i>'],
      ['script-basic', '<script>var x=1;var y=2;</script><i>end</i>'],
      ['script-comment', '<script>var x=1;// Signature pad setup\nvar y=2;</script><i>end</i>'],
      ['script-fn', '<script>var x=1;function setupSigPad(c){var d=0;}</script><i>end</i>'],
      ['script-onload', '<script>var x=1;img.onload=function(){};</script><i>end</i>'],
      ['script-long', '<script>var x="' + new Array(6001).join('a') + '";</script><i>end</i>'],
      ['script-catch', '<script>var x=1;try{f()}catch(e){}</script><i>end</i>']
    ];
    var lines = [];
    cases.forEach(function(c) {
      try {
        var h = HtmlService.createHtmlOutput(c[1]).getContent();
        lines.push(c[0] + ':len=' + h.length + ':content=' + h.replace(/\n/g, ' '));
      } catch (err) {
        lines.push(c[0] + ':ERROR:' + err.toString());
      }
    });
    return ContentService.createTextOutput(lines.join('\n'))
      .setMimeType(ContentService.MimeType.TEXT);
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
  const wifePnr       = (e.parameter.wifePnr       || '').trim();
  // Back-compat: old clients sent a single isMember flag
  const isMember      = (e.parameter.isMember      || '').trim();
  const husbandMember = (e.parameter.husbandMember || isMember || '').trim();
  const wifeMember    = (e.parameter.wifeMember    || isMember || '').trim();
  // New clients send the chosen path: 'paid' (Stripe fee) or 'member' (FIFS member)
  const path          = (e.parameter.path          || '').trim();

  if (!email || !phone || !husbandPnr || !wifePnr) {
    return jsonResponse({ success: false, error: 'Missing required fields: email, phone, husbandPnr, wifePnr' });
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

  // Extract phone digits for links
  const phoneDigits = phone.replace(/\D/g, '');

  // Build Bekräfta link (URL-encode params for safety)
  const confirmParams = 'action=confirm'
    + '&email=' + encodeURIComponent(email)
    + '&preferredDate=' + encodeURIComponent(preferredDate)
    + '&preferredTime=' + encodeURIComponent(preferredTime)
    + '&personnummer=' + encodeURIComponent(husbandPnr)
    + '&wifePnr=' + encodeURIComponent(wifePnr)
    + '&path=' + encodeURIComponent(path)
    + '&husbandMember=' + encodeURIComponent(husbandMember)
    + '&wifeMember=' + encodeURIComponent(wifeMember);
  const gasUrl = (e.parameter.gasUrl || '').trim();
  const confirmUrl = gasUrl + '?' + confirmParams;

  // ── HTML Email to mosque ──────────────────────
  const mosqueSubject = 'Ny vigselförfrågan - ' + husbandPnr + ' & ' + wifePnr;
  const contractLink = 'https://alsalamcenter.se/marriage/?step=2';
  const folderLink = coupleFolder.getUrl();
  const pathText = path === 'paid' ? 'Betald via Stripe — 1 200 SEK'
                 : path === 'member' ? 'Medlem i moskén — ingen avgift nu'
                 : '';
  const husbandMemberText = husbandMember === 'true' ? 'Ja' : 'Nej';
  const wifeMemberText = wifeMember === 'true' ? 'Ja' : 'Nej';
  const dateDisplay = preferredDate || '---';
  const timeDisplay = preferredTime || 'Valfri tid';
  const notesDisplay = notes || '---';
  const phoneDisplay = phone || '---';

  // Build mailto and WhatsApp links
  var emailLink = 'mailto:' + email;
  var phoneLink = '';
  if (phoneDigits) {
    var waNumber = phoneDigits.replace(/^0+/, '46');
    phoneLink = 'https://wa.me/' + waNumber;
  }

  const mosqueHtml = [
    '<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0;padding:16px;color:#222;">',
    '<h2 style="color:#15546f;margin-top:0;">Ny vigselförfrågan</h2>',
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:16px;">',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Brudgummens personnummer:</td><td>' + husbandPnr + '</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Brudens personnummer:</td><td>' + wifePnr + '</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">E-post:</td><td><a href="' + emailLink + '" style="color:#15546f;">' + email + '</a></td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Telefon:</td><td>' + (phoneLink ? '<a href="' + phoneLink + '" style="color:#15546f;">' + phoneDisplay + '</a>' : phoneDisplay) + '</td></tr>',
    (pathText
      ? '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Betalningsval:</td><td>' + pathText + '</td></tr>'
      : '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Brudgummen medlem:</td><td>' + husbandMemberText + '</td></tr>'
        + '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Bruden medlem:</td><td>' + wifeMemberText + '</td></tr>'),
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Önskat datum:</td><td>' + dateDisplay + '</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Önskad tid:</td><td>' + timeDisplay + '</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Önskemål:</td><td>' + notesDisplay + '</td></tr>',
    '</table>',
    (phoneLink
      ? '<p style="margin-bottom:8px;font-weight:700;">Kontakta paret via WhatsApp:</p>'
        + '<a href="' + phoneLink + '" style="display:inline-block;background:#25D366;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">&#x1F4F1; WhatsApp &#8212; ' + phoneDisplay + '</a>'
        + '<p style="margin-top:8px;font-size:13px;color:#666;">Knappen öppnar en chatt direkt i WhatsApp.</p>'
      : ''),
    '<p style="margin-bottom:4px;margin-top:16px;"><a href="' + folderLink + '" style="color:#15546f;font-weight:600;">Öppna dokumentmapp</a></p>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">',
    '<p style="margin-bottom:8px;font-weight:700;">Klicka på knappen nedan för att bekräfta tiden:</p>',
    '<a href="' + confirmUrl + '" style="display:inline-block;background:#15546f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:16px;">Bekräfta tiden</a>',
    '<p style="margin-top:0;font-size:13px;color:#666;">Du kommer till en sida där du kan justera datum och tid vid behov innan bekräftelsen skickas.</p>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">',
    '<p style="margin-bottom:4px;">Äktenskapskontrakt (paret fyller i efter bekräftelse):</p>',
    '<p style="margin-top:0;"><a href="' + contractLink + '" style="color:#15546f;">' + contractLink + '</a></p>',
    '</body></html>'
  ].join('');

  GmailApp.sendEmail('info@alsalamcenter.se', mosqueSubject, '', {
    htmlBody: mosqueHtml,
    name: 'Al-Salam Center - Vigsel'
  });

  // ── Confirmation email to user ─────────────────
  var dateStr = preferredDate || '---';
  if (preferredTime) dateStr += ' kl. ' + preferredTime;

  const userSubject = 'Vigselförfrågan mottagen - Al-Salam Center';
  const userBody = [
    'Salam alaykom!',
    '',
    'Vi har mottagit er förfrågan om vigsel (personnummer: ' + husbandPnr + ' och ' + wifePnr + ').',
    '',
    'Nästa steg:',
    '',
    '1. Moskén granskar er bokningsförfrågan och era dokument. Efter granskning får ni ett bekräftelsemejl med den bokade tiden (' + dateStr + ') eller en ny tid som passar moskén bättre. Kontrollera er inkorg och även skräpposten.',
    '',
    '2. När moskén har bekräftat tiden får ni ett mejl med den bokade tiden och en länk för att fylla i äktenskapskontraktet.',
    '',
    '3. När ni har fyllt i äktenskapsformuläret är allt klart från er sida inför ceremonin.',
    '',
    'Detta är ett automatiskt mejl. Vänligen svara inte på det. Vid frågor, kontakta oss på info@alsalamcenter.se.',
    '',
    'Må Allah välsigna er,',
    'Al-Salam Center i Helsingborg'
  ].join('\n');

  GmailApp.sendEmail(email, userSubject, userBody, {
    name: 'Al-Salam Center'
  });

  return jsonResponse({ success: true, folderUrl: coupleFolder.getUrl() });
}

// ── Action: confirm (imam clicks Bekräfta button → shows editable form) ─

function handleConfirm(e) {
  const email         = (e.parameter.email         || '').trim();
  const preferredDate = (e.parameter.preferredDate || '').trim();
  const preferredTime = (e.parameter.preferredTime || '12:00').trim();
  const personnummer  = (e.parameter.personnummer  || '').trim();
  // Optional params — old in-flight links without them must keep working
  const wifePnr       = (e.parameter.wifePnr       || '').trim();
  const isMember      = (e.parameter.isMember      || '').trim();
  const husbandMember = (e.parameter.husbandMember || isMember || '').trim();
  const wifeMember    = (e.parameter.wifeMember    || '').trim();
  const path          = (e.parameter.path          || '').trim();
  const gasUrl        = ScriptApp.getService().getUrl();

  if (!email || !preferredDate || !personnummer) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;">' +
      '<h2 style="color:#dc3545;">Saknad information</h2>' +
      '<p>Länken är ofullständig. Kontrollera att alla parametrar finns.</p>' +
      '</body></html>'
    );
  }

  var pathText = path === 'paid' ? 'Betald via Stripe — 1 200 SEK'
               : path === 'member' ? 'Medlem i moskén — ingen avgift nu'
               : '';
  var memberRows = pathText
    ? '<tr><td>Betalningsval:</td><td>' + pathText + '</td></tr>'
    : '<tr><td>Brudgummen medlem:</td><td>' + (husbandMember === 'true' ? 'Ja' : 'Nej') + '</td></tr>'
      + (wifePnr ? '<tr><td>Bruden medlem:</td><td>' + (wifeMember === 'true' ? 'Ja' : 'Nej') + '</td></tr>' : '');

  // Show an editable form so the imam can adjust date/time before confirming
  var html = [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Bekräfta vigseltid</title>',
    '<style>',
    'body{font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:40px auto;padding:20px;color:#222;background:#f5f5f5;}',
    '.card{background:#fff;border-radius:12px;padding:28px 24px;box-shadow:0 2px 12px rgba(0,0,0,.08);}',
    'h2{color:#15546f;margin-top:0;}',
    '.row{margin-bottom:14px;}',
    'label{display:block;font-weight:700;margin-bottom:4px;font-size:14px;}',
    'input[type=date],input[type=time],select{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px;box-sizing:border-box;}',
    'table{width:100%;border-collapse:collapse;margin-bottom:18px;}',
    'td{padding:8px 6px;border-bottom:1px solid #eee;font-size:14px;}',
    'td:first-child{font-weight:700;white-space:nowrap;padding-right:12px;}',
    '.btn{display:inline-block;background:#15546f;color:#fff;padding:14px 32px;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;width:100%;}',
    '.btn:hover{background:#0e4057;}',
    '#status{margin-top:16px;display:none;padding:12px;border-radius:8px;text-align:center;}',
    '.success{background:#d4edda;color:#155724;border:1px solid #c3e6cb;}',
    '.error{background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;}',
    '</style>',
    '</head><body>',
    '<div class="card">',
    '<h2>Bekräfta vigseltid</h2>',
    '<table>',
    '<tr><td>Brudgummens personnummer:</td><td>' + personnummer + '</td></tr>',
    (wifePnr ? '<tr><td>Brudens personnummer:</td><td>' + wifePnr + '</td></tr>' : ''),
    '<tr><td>E-post:</td><td>' + email + '</td></tr>',
    memberRows,
    '</table>',
    '<p style="font-size:14px;color:#666;">Justera datum och tid vid behov, klicka sedan på Bekräfta.</p>',
    '<div class="row"><label for="dateInput">Datum</label><input type="date" id="dateInput" value="' + preferredDate + '"></div>',
    '<div class="row"><label for="timeInput">Tid</label><input type="time" id="timeInput" value="' + preferredTime + '"></div>',
    '<button class="btn" onclick="submitConfirm()">Bekräfta och skicka formulärlänk</button>',
    '<div id="status"></div>',
    '</div>',
    '<script>',
    'function submitConfirm(){',
    'var btn=document.querySelector(".btn");btn.disabled=true;btn.textContent="Skickar...";',
    'var st=document.getElementById("status");st.style.display="none";',
    'var d=document.getElementById("dateInput").value;',
    'var t=document.getElementById("timeInput").value||"12:00";',
    'var params=new URLSearchParams();',
    'params.append("action","confirm-submit");',
    'params.append("email","' + email + '");',
    'params.append("preferredDate",d);',
    'params.append("preferredTime",t);',
    'params.append("personnummer","' + personnummer + '");',
    'params.append("wifePnr","' + wifePnr + '");',
    'params.append("husbandMember","' + husbandMember + '");',
    'params.append("wifeMember","' + wifeMember + '");',
    'params.append("path","' + path + '");',
    'fetch("' + gasUrl + '",{method:"POST",body:params})',
    '.then(function(r){return r.text().then(function(txt){try{return JSON.parse(txt);}catch(e){if(r.ok)return{success:true};throw new Error(txt.substring(0,200));}});})',
    '.then(function(r){',
    'st.style.display="block";',
    'if(r.success){',
    'st.className="success";',
    'st.innerHTML="Tiden har bekräftats!<br>E-post med formulärlänk har skickats till <strong>' + email + '</strong>.";',
    'btn.style.display="none";',
    '}else{',
    'st.className="error";',
    'st.textContent="Något gick fel: "+(r.error||"Okänt fel");',
    'btn.disabled=false;btn.textContent="Bekräfta och skicka formulärlänk";',
    '}',
    '})',
    '.catch(function(err){',
    'st.style.display="block";st.className="error";',
    'st.textContent="Anslutningsfel. Försök igen.";',
    'btn.disabled=false;btn.textContent="Bekräfta och skicka formulärlänk";',
    '});',
    '}',
    '</script>',
    '</body></html>'
  ].join('');

  return HtmlService.createHtmlOutput(html)
    .setTitle('Bekräfta vigseltid')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Action: confirm-submit (imam submits the edited time) ─────────

function handleConfirmSubmit(e) {
  const email         = (e.parameter.email         || '').trim();
  const preferredDate = (e.parameter.preferredDate || '').trim();
  const preferredTime = (e.parameter.preferredTime || '12:00').trim();
  const personnummer  = (e.parameter.personnummer  || '').trim();
  // Optional params — old in-flight links without them must keep working
  const wifePnr       = (e.parameter.wifePnr       || '').trim();
  const isMember      = (e.parameter.isMember      || '').trim();
  const husbandMember = (e.parameter.husbandMember || isMember || '').trim();
  const wifeMember    = (e.parameter.wifeMember    || '').trim();
  const path          = (e.parameter.path          || '').trim();

  if (!email || !preferredDate || !personnummer) {
    return jsonResponse({ success: false, error: 'Saknad information (email, datum, personnummer).' });
  }

  const pathLine = path === 'paid' ? 'Betald via Stripe — 1 200 SEK'
                 : path === 'member' ? 'Medlem i moskén — ingen avgift nu'
                 : '';
  const memberLines = pathLine
    ? '\nBetalningsval: ' + pathLine
    : '\nBrudgummen medlem: ' + (husbandMember === 'true' ? 'Ja' : 'Nej')
      + (wifePnr ? '\nBruden medlem: ' + (wifeMember === 'true' ? 'Ja' : 'Nej') : '');

  // Parse date + time and create calendar event (2 hours)
  const startTime = new Date(preferredDate + 'T' + preferredTime + ':00');
  if (isNaN(startTime.getTime())) {
    return jsonResponse({ success: false, error: 'Ogiltigt datum/tid: ' + preferredDate + ' ' + preferredTime });
  }
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

  // Create calendar event
  let calendarLink = '';
  let calendarError = '';
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const event = cal.createEvent(
      'Vigsel: ' + personnummer + (wifePnr ? ' & ' + wifePnr : ''),
      startTime,
      endTime,
      {
        description: 'Personnummer (brudgum): ' + personnummer
          + (wifePnr ? '\nPersonnummer (brud): ' + wifePnr : '')
          + '\nEmail: ' + email + '\nDatum: ' + preferredDate + '\nTid: ' + preferredTime
          + memberLines
      }
    );
    var eventId = event.getId().replace('@google.com', '');
    calendarLink = 'https://calendar.google.com/calendar/event?eid=' + encodeURIComponent(eventId);
  } catch (ex) {
    calendarError = ex.toString();
  }

  // ── HTML acceptance email to user (contract link, both PNRs prefilled) ──
  const acceptSubject = 'Vigseltid bekräftad - Al-Salam Center';
  const step2Url = 'https://alsalamcenter.se/marriage/?step=2'
    + '&husbandPnr=' + encodeURIComponent(personnummer)
    + (wifePnr ? '&wifePnr=' + encodeURIComponent(wifePnr) : '');

  var wifePnrRow = wifePnr
    ? '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Brudens personnummer:</td><td>' + wifePnr + '</td></tr>'
    : '';

  const acceptHtml = [
    '<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0;padding:16px;color:#222;">',
    '<h2 style="color:#15546f;margin-top:0;">Vigseltid bekräftad</h2>',
    '<p>Salam alaykom,</p>',
    '<p>Er tid för vigselceremonin har blivit bekräftad: <strong>' + preferredDate + ' kl. ' + preferredTime + '</strong>.</p>',
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:16px;">',
    '<tr><td style="font-weight:700;white-space:nowrap;vertical-align:top;padding-right:12px;">Brudgummens personnummer:</td><td>' + personnummer + '</td></tr>',
    wifePnrRow,
    '</table>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">',
    '<p style="margin-bottom:8px;font-weight:700;">Nästa steg är att fylla i äktenskapskontraktet:</p>',
    '<a href="' + step2Url + '" style="display:inline-block;background:#15546f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:16px;">Fyll i äktenskapskontraktet</a>',
    '<p style="font-size:13px;color:#666;">Länken öppnar formuläret med båda personnumren förifyllda. Den fungerar på vilken enhet som helst.</p>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">',
    '<p style="margin-top:20px;font-size:13px;color:#666;">Detta är ett automatiskt mejl. Vänligen svara inte på det. Vid frågor, kontakta oss på info@alsalamcenter.se.</p>',
    '<p style="margin-top:16px;">Må Allah välsigna er,<br><strong>Alsalam Center i Helsingborg</strong></p>',
    '</body></html>'
  ].join('');


  GmailApp.sendEmail(email, acceptSubject, '', {
    htmlBody: acceptHtml,
    name: 'Al-Salam Center'
  });

  return jsonResponse({ success: true, calendarLink: calendarLink, calendarError: calendarError });
}

// ── Action: submit-step2 (user submits simplified contract) ─────

function handleSubmitStep2(e) {
  const wifeName            = (e.parameter.wifeName            || '').trim();
  const husbandName         = (e.parameter.husbandName         || '').trim();
  const wifePersonalId      = (e.parameter.wifePersonalId      || '').trim();
  const husbandPersonalId   = (e.parameter.husbandPersonalId   || '').trim();
  const wifeBirthPlace      = (e.parameter.wifeBirthPlace      || '').trim();
  const husbandBirthPlace   = (e.parameter.husbandBirthPlace   || '').trim();
  const wifeMaritalStatus   = (e.parameter.wifeMaritalStatus   || '').trim();
  const husbandMaritalStatus= (e.parameter.husbandMaritalStatus|| '').trim();
  const deferredDowry       = (e.parameter.deferredDowry       || '').trim();
  const dowry               = (e.parameter.dowry               || '').trim();
  const date                = (e.parameter.date                || '').trim();
  const place               = (e.parameter.place               || '').trim();
  const email               = (e.parameter.email               || '').trim();
  const phone               = (e.parameter.phone               || '').trim();
  const husbandPnr          = (e.parameter.husbandPnr          || '').trim();
  const isMember            = (e.parameter.isMember            || '').trim();
  const preferredDate       = (e.parameter.preferredDate       || '').trim();
  const preferredTime       = (e.parameter.preferredTime       || '').trim();

  if (!wifeName || !husbandName || !wifePersonalId || !husbandPersonalId) {
    return jsonResponse({ success: false, error: 'Missing required fields (names and personal IDs).' });
  }

  // Open Google Sheet
  const sheetId = getMarriageSheetId();
  if (!sheetId) {
    return jsonResponse({ success: false, error: 'Sheet ID not configured in script properties.' });
  }

  let sheet;
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    sheet = ss.getSheetByName('Vigselansokningar');
    if (!sheet) {
      sheet = ss.insertSheet('Vigselansokningar');
      // Write header row
      sheet.appendRow([
        'Timestamp', 'Email', 'Telefon', 'Personnummer (make)', 'Medlem',
        'Maka Namn', 'Make Namn', 'Maka PNR', 'Make PNR',
        'Maka Fodelseort', 'Make Fodelseort', 'Maka Civilstand', 'Make Civilstand',
        'Uppskjuten Hemgift', 'Hemgift', 'Datum', 'Plats',
        'Onskat Datum', 'Onskad Tid', 'Status'
      ]);
    }
  } catch (ex) {
    return jsonResponse({ success: false, error: 'Spreadsheet error: ' + ex.toString() });
  }

  // Append data row
  sheet.appendRow([
    new Date(), email, phone, husbandPnr, isMember === 'true' ? 'Ja' : 'Nej',
    wifeName, husbandName, wifePersonalId, husbandPersonalId,
    wifeBirthPlace, husbandBirthPlace, wifeMaritalStatus, husbandMaritalStatus,
    deferredDowry, dowry, date, place,
    preferredDate, preferredTime, 'Inskickat'
  ]);

  // Build pre-filled imam URL
  const gasUrl = ScriptApp.getService().getUrl();
  const imamParams = 'action=imam-contract'
    + '&wifeName=' + encodeURIComponent(wifeName)
    + '&husbandName=' + encodeURIComponent(husbandName)
    + '&wifePersonalId=' + encodeURIComponent(wifePersonalId)
    + '&husbandPersonalId=' + encodeURIComponent(husbandPersonalId)
    + '&wifeBirthPlace=' + encodeURIComponent(wifeBirthPlace)
    + '&husbandBirthPlace=' + encodeURIComponent(husbandBirthPlace)
    + '&wifeMaritalStatus=' + encodeURIComponent(wifeMaritalStatus)
    + '&husbandMaritalStatus=' + encodeURIComponent(husbandMaritalStatus)
    + '&deferredDowry=' + encodeURIComponent(deferredDowry)
    + '&dowry=' + encodeURIComponent(dowry)
    + '&date=' + encodeURIComponent(date)
    + '&place=' + encodeURIComponent(place);
  const imamUrl = gasUrl + '?' + imamParams;

  // Send HTML email to imam
  const imamSubject = 'Äktenskapsformulär ifyllt - ' + (husbandPnr || husbandPersonalId);
  const imamHtml = [
    '<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0;padding:16px;color:#222;">',
    '<h2 style="color:#15546f;margin-top:0;">Äktenskapsformulär ifyllt</h2>',
    '<p>Paret har fyllt i äktenskapsformuläret digitalt. Allt är nu klart från parets sida.</p>',
    '<p>Imamen förbereder kontraktet och underskrifter sker på plats under ceremonin.</p>',
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:16px;">',
    '<tr><td style="font-weight:700;white-space:nowrap;padding-right:12px;">Maka:</td><td>' + wifeName + ' (' + wifePersonalId + ')</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;padding-right:12px;">Make:</td><td>' + husbandName + ' (' + husbandPersonalId + ')</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;padding-right:12px;">Datum:</td><td>' + (date || '---') + '</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;padding-right:12px;">Plats:</td><td>' + (place || '---') + '</td></tr>',
    '<tr><td style="font-weight:700;white-space:nowrap;padding-right:12px;">Hemgift:</td><td>' + (dowry || '---') + '</td></tr>',
    '</table>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">',
    '<p style="margin-bottom:8px;font-weight:700;">Klicka på knappen nedan för att öppna det förifyllda kontraktet:</p>',
    '<a href="' + imamUrl + '" style="display:inline-block;background:#15546f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:16px;">Oppna aktenskapskontrakt</a>',
    '<p style="font-size:13px;color:#666;">Underskrifter fylls i på plats under ceremonin.</p>',
    '</body></html>'
  ].join('');

  GmailApp.sendEmail('info@alsalamcenter.se', imamSubject, '', {
    htmlBody: imamHtml,
    name: 'Al-Salam Center - Vigsel'
  });

  return jsonResponse({ success: true });
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
    'Kopia av äktenskapskontrakt - Al-Salam Center',
    'Salam alaykom,\n\nHär är en kopia av ert äktenskapskontrakt.\n\nMå Allah välsigna er,\nAl-Salam Center i Helsingborg',
    {
      attachments: [blob],
      name: 'Al-Salam Center'
    }
  );

  return jsonResponse({ success: true });
}

// ── Action: imam-contract (GET — shows full contract pre-filled for imam) ─

function handleImamContract(e) {
  const esc = function(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };

  const wifeName            = (e.parameter.wifeName            || '').trim();
  const husbandName         = (e.parameter.husbandName         || '').trim();
  const wifePersonalId      = (e.parameter.wifePersonalId      || '').trim();
  const husbandPersonalId   = (e.parameter.husbandPersonalId   || '').trim();
  const wifeBirthPlace      = (e.parameter.wifeBirthPlace      || '').trim();
  const husbandBirthPlace   = (e.parameter.husbandBirthPlace   || '').trim();
  const wifeMaritalStatus   = (e.parameter.wifeMaritalStatus   || '').trim();
  const husbandMaritalStatus= (e.parameter.husbandMaritalStatus|| '').trim();
  const deferredDowry       = (e.parameter.deferredDowry       || '').trim();
  const dowry               = (e.parameter.dowry               || '').trim();
  const date                = (e.parameter.date                || '').trim();
  const place               = (e.parameter.place               || '').trim();
  const gasUrl              = ScriptApp.getService().getUrl();

  function selOpt(val, match) { return val === match ? ' selected' : ''; }

  var html = [
    '<!DOCTYPE html>',
    '<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Äktenskapskontrakt - ', esc(wifeName), ' &amp; ', esc(husbandName), '</title>',
    '<!-- imam-contract v2 — includes signature pads (verify this marker after redeploying) -->',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>',
    '<style>',
    '*{box-sizing:border-box}',
    'body{font-family:Arial,Helvetica,sans-serif;max-width:1100px;margin:0 auto;padding:20px;color:#222;background:#f0f0f0;}',
    '.contract-sheet{width:100%;max-width:210mm;margin:0 auto;background:#fff;border:1px solid #c7bcae;padding:50px 20px 16px;position:relative;box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden;}',
    '.contract-title{text-align:center;line-height:1.12;margin-top:8px;margin-bottom:12px;font-size:30px;font-weight:700;}',
    '.contract-subtitle{text-align:center;font-size:14px;line-height:1.55;margin:8px 0 16px 0;}',
    '.contract-grid{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid #222;border-bottom:none;}',
    '.contract-cell{border-right:1.5px solid #222;border-bottom:1.5px solid #222;min-height:46px;padding:8px 10px;display:flex;align-items:center;gap:6px;font-size:14px;}',
    '.contract-cell:nth-child(2n){border-right:none;}',
    '.contract-label{min-width:100px;font-size:13px;color:#111;font-weight:700;}',
    '.contract-label.small{min-width:76px;}',
    '.contract-input{width:100%;border:none;outline:none;background:transparent;font-size:15px;font-family:inherit;color:#111;}',
    'select.contract-input{cursor:pointer;}',
    '.contract-terms{border:1.5px solid #222;border-top:none;padding:10px 12px;line-height:1.7;font-size:14px;text-align:center;}',
    '.contract-signature-grid{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid #222;border-top:none;}',
    '.contract-sig-cell{border-right:1.5px solid #222;border-bottom:1.5px solid #222;min-height:90px;padding:8px 10px;}',
    '.contract-sig-cell:nth-child(2n){border-right:none;}',
    '.contract-sig-label{font-size:13px;font-weight:700;margin-bottom:8px;}',
    '.sig-canvas-wrap{position:relative;display:block;}',
    '.signature-pad{display:block;width:100%;height:64px;border:1px solid #b7b7b7;border-radius:8px;background:transparent;cursor:crosshair;touch-action:none;}',
    '.sig-clear-btn{position:absolute;top:4px;right:4px;background:rgba(255,255,255,0.9);border:1px solid #ccc;border-radius:50%;width:26px;height:26px;font-size:15px;line-height:24px;cursor:pointer;padding:0;color:#888;z-index:2;display:flex;align-items:center;justify-content:center;}',
    '.sig-clear-btn:hover{color:#d9534f;border-color:#d9534f;}',
    '.contract-last-grid{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid #222;border-top:none;}',
    '.contract-last-cell{border-right:1.5px solid #222;border-bottom:1.5px solid #222;padding:8px 10px;min-height:52px;display:flex;align-items:center;gap:6px;}',
    '.contract-last-cell:nth-child(2n){border-right:none;}',
    '.contract-notice{margin-top:14px;border:2px solid #b54b4b;color:#b54b4b;padding:10px 14px;text-align:center;line-height:1.7;font-size:14px;font-weight:700;}',
    '.toolbar{max-width:210mm;margin:0 auto 18px auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:center;}',
    '.toolbar button{border:1px solid #333;background:#fff;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;}',
    '.toolbar button.success{background:#196f15;color:#fff;border-color:#196f15;}',
    '.preview-box{border:1px solid #bbb;background:#fff;min-height:420px;border-radius:8px;overflow:hidden;display:none;max-width:210mm;margin:20px auto 0;}',
    '.preview-box iframe{width:100%;height:70vh;border:0;display:block;}',
    '.send-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:none;align-items:center;justify-content:center;}',
    '.send-confirm-box{background:#fff;border-radius:14px;padding:32px 28px;max-width:460px;width:92%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.25);}',
    '.send-confirm-box p{font-size:16px;margin:0 0 24px 0;line-height:1.55;color:#222;}',
    '.send-confirm-buttons{display:flex;gap:12px;justify-content:center;}',
    '.send-confirm-buttons button{border:none;padding:10px 28px;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;}',
    '.send-confirm-cancel{background:#e0e0e0;color:#333;}',
    '.send-confirm-send{background:#1a8a1f;color:#fff;}',
    '@media(max-width:900px){.contract-grid,.contract-signature-grid,.contract-last-grid{grid-template-columns:1fr}.contract-cell:nth-child(2n),.contract-sig-cell:nth-child(2n),.contract-last-cell:nth-child(2n){border-right:none}}',
    '</style>',
    '</head><body>',
    '<div class="toolbar">',
    '<button onclick="previewPDF()">Forhandsgranska PDF</button>',
    '<button onclick="downloadPDF()">Ladda ner PDF</button>',
    '<button class="success" onclick="sendPDF()">Skicka</button>',
    '</div>',
    '<div class="contract-sheet" id="contract">',
    '<img src="https://alsalamcenter.se/marriage/img/corner_upper_left.png" style="position:absolute;top:-28px;left:-28px;width:clamp(150px,18vw,210px);height:auto;pointer-events:none;z-index:0;" alt="">',
    '<img src="https://alsalamcenter.se/marriage/img/corner_upper_left.png" style="position:absolute;top:-28px;right:-28px;width:clamp(150px,18vw,210px);height:auto;pointer-events:none;z-index:0;transform:rotate(90deg);" alt="">',
    '<div class="contract-title">Islamiskt aktenskapskontrakt</div>',
    '<div class="contract-subtitle">Aktenskapskontrakt i enlighet med islamisk sedvana och med faststalld Mahr (hemgift) och villkor.</div>',
    '<div class="contract-grid">',
    '<div class="contract-cell"><div class="contract-label">Maka</div><input class="contract-input" id="wifeNameInput" value="', esc(wifeName), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Make</div><input class="contract-input" id="husbandNameInput" value="', esc(husbandName), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Personnummer</div><input class="contract-input" id="wifePersonalIdInput" value="', esc(wifePersonalId), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Personnummer</div><input class="contract-input" id="husbandPersonalIdInput" value="', esc(husbandPersonalId), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Fodelseort</div><input class="contract-input" id="wifeBirthPlaceInput" value="', esc(wifeBirthPlace), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Fodelseort</div><input class="contract-input" id="husbandBirthPlaceInput" value="', esc(husbandBirthPlace), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Civilstand</div><select class="contract-input" id="wifeMaritalStatusInput"><option value="">---</option><option value="Ogift"', selOpt(wifeMaritalStatus,'Ogift'), '>Ogift</option><option value="Gift"', selOpt(wifeMaritalStatus,'Gift'), '>Gift</option><option value="Skild"', selOpt(wifeMaritalStatus,'Skild'), '>Skild</option><option value="Anka/Ankling"', selOpt(wifeMaritalStatus,'Anka/Ankling'), '>Anka/Ankling</option></select></div>',
    '<div class="contract-cell"><div class="contract-label">Civilstand</div><select class="contract-input" id="husbandMaritalStatusInput"><option value="">---</option><option value="Ogift"', selOpt(husbandMaritalStatus,'Ogift'), '>Ogift</option><option value="Gift"', selOpt(husbandMaritalStatus,'Gift'), '>Gift</option><option value="Skild"', selOpt(husbandMaritalStatus,'Skild'), '>Skild</option><option value="Anka/Ankling"', selOpt(husbandMaritalStatus,'Anka/Ankling'), '>Anka/Ankling</option></select></div>',
    '<div class="contract-cell"><div class="contract-label">Uppskjuten hemgift</div><input class="contract-input" id="deferredDowryInput" value="', esc(deferredDowry), '"></div>',
    '<div class="contract-cell"><div class="contract-label">Hemgift</div><input class="contract-input" id="dowryInput" value="', esc(dowry), '"></div>',
    '</div>',
    '<div class="contract-terms">Al salam Moskés imamkommitte har ratt att saga upp detta kontrakt om nagon av makarna begar det.</div>',
    '<div class="contract-signature-grid">',
    '<div class="contract-sig-cell"><div class="contract-sig-label">Underskrift maka</div><div class="sig-canvas-wrap"><canvas class="signature-pad"></canvas><button type="button" class="sig-clear-btn">&#x21BA;</button></div></div>',
    '<div class="contract-sig-cell"><div class="contract-sig-label">Underskrift make</div><div class="sig-canvas-wrap"><canvas class="signature-pad"></canvas><button type="button" class="sig-clear-btn">&#x21BA;</button></div></div>',
    '<div class="contract-sig-cell"><div class="contract-sig-label">Vittne 2</div><input class="contract-input" style="border:1px solid #ccc;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:13px;" placeholder="Namn" id="witness2NameInput"><div class="sig-canvas-wrap"><canvas class="signature-pad"></canvas><button type="button" class="sig-clear-btn">&#x21BA;</button></div></div>',
    '<div class="contract-sig-cell"><div class="contract-sig-label">Vittne 1</div><input class="contract-input" style="border:1px solid #ccc;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:13px;" placeholder="Namn" id="witness1NameInput"><div class="sig-canvas-wrap"><canvas class="signature-pad"></canvas><button type="button" class="sig-clear-btn">&#x21BA;</button></div></div>',
    '<div class="contract-sig-cell"><div class="contract-sig-label">Imam</div><input class="contract-input" style="border:1px solid #ccc;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:13px;" placeholder="Namn" id="imamNameInput"><div class="sig-canvas-wrap"><canvas class="signature-pad"></canvas><button type="button" class="sig-clear-btn">&#x21BA;</button></div></div>',
    '<div class="contract-sig-cell"><div class="contract-sig-label">Wali</div><input class="contract-input" style="border:1px solid #ccc;border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:13px;" placeholder="Namn" id="waliNameInput"><div class="sig-canvas-wrap"><canvas class="signature-pad"></canvas><button type="button" class="sig-clear-btn">&#x21BA;</button></div></div>',
    '</div>',
    '<div class="contract-last-grid">',
    '<div class="contract-last-cell"><div class="contract-label small">Datum</div><input class="contract-input" type="date" id="dateInput" value="', esc(date), '"></div>',
    '<div class="contract-last-cell"><div class="contract-label small">Plats</div><input class="contract-input" id="placeInput" value="', esc(place), '"></div>',
    '</div>',
    '<div class="contract-notice">Detta ar ett religiost aktenskapskontrakt som inte kan registreras hos Skatteverket.</div>',
    '</div>',
    '<div class="preview-box" id="previewBox"><iframe id="previewFrame"></iframe></div>',
    '<div class="send-confirm-overlay" id="sendConfirmOverlay">',
    '<div class="send-confirm-box">',
    '<div id="confirm-state"><p id="sendConfirmBody">Ar du saker pa att all information stammer och vill skicka in formularet?</p><div class="send-confirm-buttons"><button class="send-confirm-cancel" id="sendConfirmCancelBtn">Avbryt</button><button class="send-confirm-send" id="sendConfirmSendBtn">Skicka</button></div></div>',
    '<div id="confirm-loading-state" style="display:none;"><div class="spinner-border" style="width:3rem;height:3rem;color:#1a8a1f;border:4px solid rgba(26,138,31,.25);border-top-color:#1a8a1f;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div><p id="confirm-loading-text">Skickar formularet ...</p></div>',
    '<div id="confirm-success-state" style="display:none;"><p id="confirm-success-text" style="color:#1a8a1f;font-weight:700;">Formularet har skickats in!</p></div>',
    '<div id="confirm-error-state" style="display:none;"><p id="confirm-error-text" style="color:#dc3545;font-weight:700;"></p><button id="confirm-error-close" class="send-confirm-cancel">Stang</button></div>',
    '</div>',
    '</div>',
    '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>',
    '<!-- Page script lives in https://alsalamcenter.se/marriage/js/imam-contract.js — the GAS HtmlService sandbox corrupts inline scripts -->',
    '<script src="https://alsalamcenter.se/marriage/js/imam-contract.js?v=1"><\/script>',
    '</body></html>'
  ].join('');

  if ((e.parameter.diag || '') === '1') {
    return ContentService.createTextOutput(
      'diag htmlLen=' + html.length
      + ' | hasScript=' + (html.indexOf('imam-contract.js') >= 0)
      + ' | hasV2=' + (html.indexOf('imam-contract v2') >= 0)
      + ' | tail=' + html.substring(Math.max(0, html.length - 80))
    ).setMimeType(ContentService.MimeType.TEXT);
  }

  return HtmlService.createHtmlOutput(html)
    .setTitle('Äktenskapskontrakt')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
