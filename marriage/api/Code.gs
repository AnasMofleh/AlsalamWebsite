/**
 * Google Apps Script — Marriage Contract Upload
 *
 * Receives a PDF via POST, saves it to Google Drive in a "Marriage Contracts" folder,
 * and emails info@alsalamcenter.se with the PDF attached.
 *
 * DEPLOYMENT:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into Code.gs
 * 3. Click Deploy → New Deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the deployment URL and paste it into marriage/index.html as GAS_URL
 */

function doPost(e) {
  try {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(e.parameter.pdf),
      'application/pdf',
      e.parameter.filename || 'islamic-marriage-contract.pdf'
    );

    const folder = DriveApp.getFolderById('19k773mFMvLlQRswYWgKL2bghyNI4IZLe');
    const file = folder.createFile(blob);
    file.setDescription('Uploaded on ' + new Date().toISOString());

    const wifeName   = e.parameter.wifeName   || '—';
    const husbandName = e.parameter.husbandName || '—';
    const date       = e.parameter.date        || '—';

    const subject = 'Nytt äktenskapskontrakt – ' + wifeName + ' & ' + husbandName;
    const body = [
      'Ett nytt äktenskapskontrakt har skickats in.',
      '',
      'Maka:      ' + wifeName,
      'Make:      ' + husbandName,
      'Datum:     ' + date,
      '',
      'PDF: ' + file.getUrl(),
      '',
      'Detta är ett automatiskt meddelande från Al-Salam Moskés hemsida.'
    ].join('\n');

    GmailApp.sendEmail('info@alsalamcenter.se', subject, body, {
      attachments: [blob],
      name: 'Al-Salam Moské'
    });

    return ContentService.createTextOutput(JSON.stringify({ success: true, fileUrl: file.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// CORS preflight support for browser requests
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
