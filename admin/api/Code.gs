/**
 * Google Apps Script — Receipt Upload + Donation Certificates
 *
 * Handles uploading receipt files to Google Drive under the "receipts"
 * folder, and sending donor donation certificates as PDF email
 * attachments (action=send-certificate).
 *
 * Folder structure created automatically:
 *   receipts / YYYY / category /
 *   certificates / YYYY /
 *
 *   Categories: moskeer, transport, mat, annat
 *
 * DEPLOYMENT:
 * 1. Go to https://script.google.com → New project
 * 2. Paste this entire file into Code.gs
 * 3. Click Deploy → New Deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the deployment URL
 * 5. Update GAS_URL in admin/index.html and admin/certificate.html
 *
 * After editing this file, redeploy with a NEW VERSION:
 *   Deploy → Manage deployments → Edit → Version: New version → Deploy
 */

// ── Main entry point ──────────────────────────────────────────

function doPost(e) {
  try {
    const action = e.parameter.action || '';

    if (action === 'verify-password') {
      return handleVerifyPassword(e);
    }
    if (action === 'upload-receipt') {
      return handleUploadReceipt(e);
    }
    if (action === 'send-certificate') {
      return handleSendCertificate(e);
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    usage: 'POST with action=upload-receipt or action=send-certificate'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ── Action: verify-password ───────────────────────────────────

function handleVerifyPassword(e) {
  const password = (e.parameter.password || '').trim();

  if (!password) {
    return jsonResponse({ success: false, error: 'Missing password' });
  }

  const adminPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');

  if (password === adminPassword) {
    return jsonResponse({ success: true, authenticated: true });
  }

  return jsonResponse({ success: true, authenticated: false });
}

// ── Action: upload-receipt ────────────────────────────────────

function handleUploadReceipt(e) {
  const fileData    = e.parameter.file     || '';
  const mimeType    = e.parameter.mime     || 'application/octet-stream';
  const fileName    = e.parameter.filename || 'receipt';
  const year        = e.parameter.year     || String(new Date().getFullYear());
  const category    = e.parameter.category || 'annat';
  const receiptDate = e.parameter.receiptDate || '';
  const folderId    = e.parameter.folderId || '1M2tBkJvvyZ1zol4d9TZIjXMYezlpsi8a';

  // ── Validate required fields ──────────────────
  if (!fileData) {
    return jsonResponse({ success: false, error: 'Missing file data' });
  }

  const validCategories = ['moskeer', 'transport', 'mat', 'annat'];
  if (validCategories.indexOf(category) === -1) {
    return jsonResponse({
      success: false,
      error: 'Invalid category. Must be one of: ' + validCategories.join(', ')
    });
  }

  // Validate year range (current year ± 10 years)
  const yearNum = parseInt(year, 10);
  const currentYear = new Date().getFullYear();
  if (isNaN(yearNum) || yearNum < currentYear - 10 || yearNum > currentYear + 1) {
    return jsonResponse({ success: false, error: 'Invalid year: ' + year });
  }

  try {
    // ── Build folder structure: receipts / YYYY / category ──
    const rootFolder     = DriveApp.getFolderById(folderId);
    const receiptsFolder = getOrCreateFolder(rootFolder, 'receipts');
    const yearFolder     = getOrCreateFolder(receiptsFolder, year);
    const categoryFolder = getOrCreateFolder(yearFolder, category);

    // ── Generate unique filename with timestamp prefix ──
    const now = new Date();
    const timestamp = now.getFullYear()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0') + '_'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');

    // Extract extension from original filename
    const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? '.' + extMatch[1] : '';
    const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/, '');

    // Sanitize filename: allow only safe characters, limit length
    const safeName = baseName.replace(/[^a-zA-Z0-9åäöÅÄÖ_\- ]/g, '').substring(0, 80);
    const finalName = timestamp + '_' + safeName + ext;

    // ── Decode base64 and upload ─────────────────
    const base64Data = fileData.split(',')[1] || fileData;
    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      mimeType,
      finalName
    );

    const file = categoryFolder.createFile(blob);

    // Attach metadata as description
    const description = [
      'Original filename: ' + fileName,
      'Receipt date: ' + (receiptDate || 'N/A'),
      'Category: ' + category,
      'Uploaded: ' + now.toISOString()
    ].join('\n');
    file.setDescription(description);

    return jsonResponse({
      success: true,
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      folderUrl: categoryFolder.getUrl(),
      fileName: finalName,
      category: category,
      year: year
    });

  } catch (driveErr) {
    return jsonResponse({
      success: false,
      error: 'Drive error: ' + driveErr.toString()
    });
  }
}

// ── Action: send-certificate ──────────────────────────────────
// Donor donation certificate: validates the admin password PER REQUEST
// (unlike upload-receipt), builds a per-language HTML certificate, sends
// it to the donor as a PDF attachment via MailApp, and archives a copy
// in Drive under certificates/YYYY/.
//
// NOTE: MailApp sends from the script owner's account (Execute as: Me).
// Consumer accounts are limited to ~100 recipients/day.
//
// NOTE: redeploy with a NEW VERSION after editing this file:
//   Deploy → Manage deployments → Edit → Version: New version → Deploy

function handleSendCertificate(e) {
  // ── Auth (per request) ─────────────────────────
  const password = (e.parameter.password || '').trim();
  const adminPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!adminPassword || password !== adminPassword) {
    return jsonResponse({ success: false, error: 'Fel lösenord. Logga in på nytt i /admin/.' });
  }

  // ── Validate ───────────────────────────────────
  const name = (e.parameter.name || '').trim();
  if (!name || name.length > 120) {
    return jsonResponse({ success: false, error: 'Namn saknas eller är för långt.' });
  }
  const email = (e.parameter.email || '').trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return jsonResponse({ success: false, error: 'Ogiltig e-postadress.' });
  }
  const amountRaw = String(e.parameter.amount || '').trim().replace(/\s/g, '').replace(',', '.');
  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount <= 0 || amount > 50000000) {
    return jsonResponse({ success: false, error: 'Ogiltigt belopp.' });
  }
  const lang = (e.parameter.lang || 'sv').trim();
  if (['ar', 'en', 'sv', 'so', 'sq'].indexOf(lang) === -1) {
    return jsonResponse({ success: false, error: 'Ogiltigt språk.' });
  }

  const sqm = amount / 3000;
  const t = CERT_COPY[lang];
  const amountText = fmtAmount(lang, amount);
  const sqmText = fmtSqm(lang, sqm);

  // ── Build the certificate HTML (single-file, no GAS templates) ──
  // Picture-based certificate when a background image is available,
  // otherwise fall back to the classic styled certificate.
  const certBg = loadCertificateBackground();
  const html = certBg
    ? buildPictureCertificateHtml(lang, name, certBg, fmtSqmPlain(lang, sqm), amountText)
    : buildCertificateHtml(lang, t, name, amountText, sqmText);

  let pdfBlob;
  try {
    pdfBlob = HtmlService.createHtmlOutput(html)
      .getBlob()
      .getAs('application/pdf')
      .setName('donationsintyg-' + lang + '.pdf');
  } catch (pdfErr) {
    return jsonResponse({ success: false, error: 'PDF-fel: ' + pdfErr.toString() });
  }

  // ── Send the email first ───────────────────────
  try {
    MailApp.sendEmail({
      to: email,
      subject: t.emailSubject,
      htmlBody: t.emailBody(escHtml(name), amountText, sqmText),
      attachments: [pdfBlob]
    });
  } catch (mailErr) {
    return jsonResponse({ success: false, error: 'E-postfel: ' + mailErr.toString() });
  }

  // ── Archive a copy in Drive (failure after email → warning only) ──
  let driveWarning = '';
  let fileId = '';
  let fileUrl = '';
  try {
    const rootFolder = DriveApp.getFolderById('1M2tBkJvvyZ1zol4d9TZIjXMYezlpsi8a');
    const certFolder = getOrCreateFolder(rootFolder, 'certificates');
    const now = new Date();
    const year = String(now.getFullYear());
    const yearFolder = getOrCreateFolder(certFolder, year);
    const ts = now.getFullYear()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0') + '_'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    const safeName = name.replace(/[^a-zA-Z0-9åäöÅÄÖ_\- ]/g, '').substring(0, 80);
    const file = yearFolder.createFile(pdfBlob.setName('certificate_' + ts + '_' + safeName + '.pdf'));
    file.setDescription([
      'Donor name: ' + name,
      'Donor email: ' + email,
      'Amount (SEK): ' + String(amount),
      'Square meters: ' + sqmText,
      'Language: ' + lang,
      'Sent: ' + now.toISOString()
    ].join('\n'));
    fileId = file.getId();
    fileUrl = file.getUrl();
  } catch (driveErr) {
    driveWarning = 'Drive-fel: ' + driveErr.toString();
  }

  return jsonResponse({
    success: true,
    email: email,
    sqm: sqmText,
    fileId: fileId,
    fileUrl: fileUrl,
    driveWarning: driveWarning
  });
}

// ── Certificate copy (5 languages) ─────────────────────────────

const CERT_COPY = {
  sv: {
    title: 'Donationsintyg',
    presented: 'Detta intyg tilldelas',
    amountLine: function (x) { return 'som ett varmt tack för en generös gåva på ' + x + ' kr'; },
    sqmLine: function (y) { return 'motsvarande ' + y + ' m² av Folkets Hus-byggnaden'; },
    campaign: 'till stöd för kampanjen att köpa Folkets Hus i Helsingborg',
    dateLabel: 'Helsingborg, den',
    months: ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'],
    emailSubject: 'Ditt donationsintyg — Alsalam Center I Helsingborg',
    emailBody: function (name, x, y) {
      return '<p>Assalamu alaykum ' + name + '!</p>'
        + '<p>Tack för din generösa gåva på <strong>' + x + ' kr</strong> till Alsalam Center I Helsingborg, motsvarande <strong>' + y + ' m²</strong> av Folkets Hus-byggnaden.</p>'
        + '<p>Bifogat finns ditt donationsintyg som PDF. Må Allah belöna dig för ditt bidrag.</p>'
        + '<p>Med varma hälsningar,<br>Alsalam Center I Helsingborg<br>Org.nr 802513-6808 · Södergatan 65–67, 252 25 Helsingborg<br>info@alsalamcenter.se</p>';
    }
  },
  en: {
    title: 'Certificate of Donation',
    presented: 'This certificate is presented to',
    amountLine: function (x) { return 'in grateful recognition of a generous donation of ' + x + ' SEK'; },
    sqmLine: function (y) { return 'corresponding to ' + y + ' m² of the Folkets Hus building'; },
    campaign: 'in support of the campaign to purchase Folkets Hus in Helsingborg',
    dateLabel: 'Helsingborg,',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    emailSubject: 'Your donation certificate — Alsalam Center I Helsingborg',
    emailBody: function (name, x, y) {
      return '<p>Assalamu alaykum ' + name + '!</p>'
        + '<p>Thank you for your generous donation of <strong>' + x + ' SEK</strong> to Alsalam Center I Helsingborg, corresponding to <strong>' + y + ' m²</strong> of the Folkets Hus building.</p>'
        + '<p>Please find your donation certificate attached as a PDF. May Allah reward you for your contribution.</p>'
        + '<p>With warm regards,<br>Alsalam Center I Helsingborg<br>Org.nr 802513-6808 · Södergatan 65–67, 252 25 Helsingborg<br>info@alsalamcenter.se</p>';
    }
  },
  ar: {
    title: 'شهادة تبرع',
    presented: 'تُمنح هذه الشهادة إلى',
    amountLine: function (x) { return 'تقديراً وعرفاناً لتبرعٍ كريم بمبلغ ' + x + ' كرونة سويدية'; },
    sqmLine: function (y) { return 'بما يعادل ' + y + ' م² من مبنى بيت الشعب (Folkets Hus)'; },
    campaign: 'دعماً لحملة شراء مبنى بيت الشعب (Folkets Hus) في هلسينغبوري',
    dateLabel: 'هلسينغبوري، بتاريخ',
    months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    emailSubject: 'شهادة التبرع الخاصة بك — Alsalam Center I Helsingborg',
    emailBody: function (name, x, y) {
      return '<div dir="rtl">'
        + '<p>السلام عليكم ورحمة الله ' + name + '!</p>'
        + '<p>شكراً لتبرعكم الكريم بمبلغ <strong>' + x + ' كرونة سويدية</strong> لAlsalam Center I Helsingborg، بما يعادل <strong>' + y + ' م²</strong> من مبنى بيت الشعب (Folkets Hus).</p>'
        + '<p>مرفق شهادة التبرع الخاصة بكم بصيغة PDF. تقبل الله منكم وأجزل لكم الأجر.</p>'
        + '<p>مع أطيب التحيات،<br>Alsalam Center I Helsingborg<br>رقم المنظمة 802513-6808 · Södergatan 65–67, 252 25 Helsingborg<br>info@alsalamcenter.se</p>'
        + '</div>';
    }
  },
  so: {
    title: 'Shahaadada Deeqda',
    presented: 'Shahaadadan waxaa la siiyay',
    amountLine: function (x) { return 'si mahadnaq ah deeq furan oo dhan ' + x + ' SEK'; },
    sqmLine: function (y) { return 'taas oo u dhiganta ' + y + ' m² oo ka mid ah dhismaha Folkets Hus'; },
    campaign: 'iyadoo lagu taageerayo ololaha iibashada dhismaha Folkets Hus ee Helsingborg',
    dateLabel: 'Helsingborg, taariikhda',
    months: ['Janaayo', 'Febraayo', 'Maarso', 'Abriil', 'Maajo', 'Juun', 'Luulyo', 'Agoosto', 'Sebtembar', 'Oktoobar', 'Nofembar', 'Disembar'],
    emailSubject: 'Shahaadada deeqdaada — Alsalam Center I Helsingborg',
    emailBody: function (name, x, y) {
      return '<p>Assalaamu calaykum ' + name + '!</p>'
        + '<p>Waad ku mahadsan tahay deeqdaada qiimaha leh ee <strong>' + x + ' SEK</strong> ee Alsalam Center I Helsingborg, taas oo u dhiganta <strong>' + y + ' m²</strong> ee dhismaha Folkets Hus.</p>'
        + '<p>Shahaadadaada deeqda oo PDF ah ayaa lifaaqan. Allaah ha kaa ajiibo deeqdaada.</p>'
        + '<p>Mahadnaq,<br>Alsalam Center I Helsingborg<br>Org.nr 802513-6808 · Södergatan 65–67, 252 25 Helsingborg<br>info@alsalamcenter.se</p>';
    }
  },
  sq: {
    title: 'Certifikatë Donacioni',
    presented: 'Kjo certifikatë i jepet',
    amountLine: function (x) { return 'në shenjë mirënjohjeje për një donacion bujar prej ' + x + ' SEK'; },
    sqmLine: function (y) { return 'që korrespondon me ' + y + ' m² të ndërtesës Folkets Hus'; },
    campaign: 'në mbështetje të fushatës për blerjen e ndërtesës Folkets Hus në Helsingborg',
    dateLabel: 'Helsingborg, më',
    months: ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'],
    emailSubject: 'Certifikata juaj e donacionit — Alsalam Center I Helsingborg',
    emailBody: function (name, x, y) {
      return '<p>Selam alejkum ' + name + '!</p>'
        + '<p>Faleminderit për donacionin tuaj bujar prej <strong>' + x + ' SEK</strong> për Alsalam Center I Helsingborg, që korrespondon me <strong>' + y + ' m²</strong> të ndërtesës Folkets Hus.</p>'
        + '<p>Certifikata juaj e donacionit gjendet bashkangjitur si PDF. Allahu ju shpërbleftë për kontributin tuaj.</p>'
        + '<p>Me respekt,<br>Alsalam Center I Helsingborg<br>Org.nr 802513-6808 · Södergatan 65–67, 252 25 Helsingborg<br>info@alsalamcenter.se</p>';
    }
  }
};

function fmtAmount(lang, amount) {
  const n = Math.round(amount * 100) / 100;
  const s = n.toLocaleString(lang === 'en' ? 'en-US' : 'sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return String(s).replace(/ /g, ' ');
}

function fmtSqm(lang, sqm) {
  const n = Math.round(sqm * 100) / 100;
  const decSep = lang === 'ar' ? '٫' : (lang === 'en' ? '.' : ',');
  let s = String(n).replace('.', decSep);
  if (s.indexOf(decSep) === -1) s += decSep + '0';
  return s;
}

function localizedDate(lang) {
  const now = new Date();
  const m = CERT_COPY[lang].months[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();
  if (lang === 'en') return CERT_COPY[lang].dateLabel + ' ' + m + ' ' + day + ', ' + year;
  return CERT_COPY[lang].dateLabel + ' ' + day + ' ' + m + ' ' + year;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCertificateHtml(lang, t, name, amountText, sqmText) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const font = lang === 'ar'
    ? "'Noto Sans Arabic','Segoe UI',Tahoma,sans-serif"
    : "'Segoe UI','Open Sans',Arial,sans-serif";
  return '<!DOCTYPE html><html lang="' + lang + '" dir="' + dir + '"><head><meta charset="utf-8">'
    + '<style>'
    + '@page { size: A4; margin: 0; }'
    + 'body { width:210mm; height:297mm; margin:0; padding:10mm; box-sizing:border-box; font-family:' + font + '; color:#123b4a; }'
    + '.frame { border:3px solid #15546F; border-radius:10px; height:100%; box-sizing:border-box; padding:18mm 16mm; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; }'
    + '.emblem { font-size:11pt; letter-spacing:6px; color:#15546F; font-weight:700; margin-bottom:6mm; }'
    + 'h1 { font-size:26pt; color:#15546F; margin:0 0 8mm; }'
    + '.lead { font-size:12pt; color:#4a6572; margin:0 0 4mm; }'
    + '.name { font-size:22pt; font-weight:700; margin:0 0 8mm; }'
    + '.amount { font-size:14pt; margin:0 0 2mm; }'
    + '.sqm { font-size:13pt; color:#1a6b8a; font-weight:600; margin:0 0 6mm; }'
    + '.campaign { font-size:11.5pt; max-width:130mm; margin:0 0 8mm; }'
    + '.org { font-size:10.5pt; line-height:1.6; color:#4a6572; margin:0 0 6mm; }'
    + '.date { font-size:10.5pt; margin:0 0 10mm; }'
    + '.sign { font-size:10pt; color:#4a6572; }'
    + '</style></head><body>'
    + '<div class="frame">'
    + '<div class="emblem">AL-SALAM</div>'
    + '<h1>' + escHtml(t.title) + '</h1>'
    + '<p class="lead">' + escHtml(t.presented) + '</p>'
    + '<div class="name">' + escHtml(name) + '</div>'
    + '<p class="amount">' + escHtml(t.amountLine(amountText)) + '</p>'
    + '<p class="sqm">' + escHtml(t.sqmLine(sqmText)) + '</p>'
    + '<p class="campaign">' + escHtml(t.campaign) + '</p>'
    + '<p class="org">Alsalam Center I Helsingborg<br>Org.nr 802513-6808<br>Södergatan 65–67, 252 25 Helsingborg, Sverige</p>'
    + '<p class="date">' + escHtml(localizedDate(lang)) + '</p>'
    + '<div class="sign">________________________<br>Alsalam Center I Helsingborg</div>'
    + '</div></body></html>';
}

// ── Picture-based certificate ──────────────────────────────────
// The certificate background is a picture (img/certificate_background.png). The text is
// placed at pixel offsets measured from the BOTTOM of the picture. The
// image is loaded from the live site first, then from the Drive root
// folder as a fallback — replacing the image file updates the design
// without redeploying this script. If no image is found, the classic
// styled certificate (buildCertificateHtml) is used instead.

const CERT_BG_NAME = 'certificate_background.png';
const CERT_BG_URL = 'https://alsalamcenter.se/img/certificate_background.png';
// Positions + font sizes in pixels of the original picture (2918 x 1965),
// identical to the preview in admin/certificate.html.
const CERT_PIC_POS = { title: 1128, name: 820, dua1: 525, dua2: 425, thanks: 265 };
const CERT_PIC_FONT = { title: 70, name: 118, dua: 60, thanks: 78 };
const CERT_PIC_COPY = {
  ar: {
    title: 'شهادة تبرع من وقف السلام في هلسنبوري',
    dua1: function (m) {
      if (m === '1') return 'تقبّل الله صدقتكم بمتر مربع';
      if (m === '2') return 'تقبّل الله صدقتكم بمترين مربعين';
      if (/^([3-9]|10)$/.test(m)) return 'تقبّل الله صدقتكم بـ ' + m + ' أمتار مربعة';
      return 'تقبّل الله صدقتكم بـ ' + m + ' متر مربع';
    },
    dua2: function (x) { return 'وقيمتها ' + x + ' كرون سويدي'; },
    thanks: 'جزاكم الله خيراً وبنى لكم بيتاً في الجنة',
    rtl: true
  },
  sv: {
    title: 'Donationsintyg från Alsalam Wakf in Helsingborg',
    dua1: function (m) { return 'Må Allah acceptera er gåva på ' + m + ' kvadratmeter'; },
    dua2: function (x) { return 'till ett värde av ' + x + ' kr'; },
    thanks: 'Må Allah belöna er och bygga ett hus åt er i Paradiset',
    rtl: false
  },
  en: {
    title: 'Donation Certificate from Alsalam Wakf in Helsingborg',
    dua1: function (m) { return 'May Allah accept your donation of ' + m + (m === '1' ? ' square metre' : ' square metres'); },
    dua2: function (x) { return 'valued at ' + x + ' SEK'; },
    thanks: 'May Allah reward you and build for you a house in Paradise',
    rtl: false
  },
  so: {
    title: 'Shahaadada Deeqda ee Alsalam Wakf in Helsingborg',
    dua1: function (m) { return 'Allaah ha aqbalo sadaqadiinna ee ' + m + ' mitir labajibbaaran'; },
    dua2: function (x) { return 'oo qiimihiisu yahay ' + x + ' SEK'; },
    thanks: 'Allaah ha idinka abaalmariyo, gurina Jannada ha idiinka dhiso',
    thanksSize: 62, // smaller so the longer Somali line fits on one line
    rtl: false
  },
  sq: {
    title: 'Certifikatë Donacioni nga Alsalam Wakf in Helsingborg',
    dua1: function (m) { return 'Allahu e pranoftë sadakanë tuaj prej ' + m + (m === '1' ? ' metri katror' : ' metrash katrorë'); },
    dua2: function (x) { return 'me vlerë ' + x + ' SEK'; },
    thanks: 'Allahu ju shpërbleftë dhe ju ndërtoftë një shtëpi në Xhenet',
    rtl: false
  }
};

function fmtSqmPlain(lang, sqm) {
  // 6000 kr → "2", 7500 kr → "2,5" (no forced decimals)
  var n = Math.round(sqm * 100) / 100;
  var decSep = lang === 'ar' ? '٫' : (lang === 'en' ? '.' : ',');
  return String(n).replace('.', decSep);
}

function loadCertificateBackground() {
  let bytes = null;
  let mime = 'image/jpeg';

  // 1) Live site (single source of truth once deployed)
  try {
    const resp = UrlFetchApp.fetch(CERT_BG_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      const blob = resp.getBlob();
      bytes = blob.getBytes();
      mime = blob.getContentType() || mime;
    }
  } catch (e) {}

  // 2) Drive root folder fallback
  if (!bytes) {
    try {
      const root = DriveApp.getFolderById('1M2tBkJvvyZ1zol4d9TZIjXMYezlpsi8a');
      const files = root.getFilesByName(CERT_BG_NAME);
      if (files.hasNext()) {
        const blob = files.next().getBlob();
        bytes = blob.getBytes();
        mime = blob.getContentType() || mime;
      }
    } catch (e) {}
  }

  if (!bytes || bytes.length < 32) return null;
  const dims = getImageDimensions(bytes, mime);
  if (!dims) return null;
  return {
    dataUri: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes),
    width: dims.width,
    height: dims.height
  };
}

// Minimal PNG / JPEG / WebP dimension readers (width/height from headers).
function getImageDimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length > 24) {
    return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
  }
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        return { width: readUInt16BE(bytes, i + 7), height: readUInt16BE(bytes, i + 5) };
      }
      const segLen = readUInt16BE(bytes, i + 2);
      if (segLen < 2) return null;
      i += 2 + segLen;
    }
    return null;
  }
  if (mime === 'image/webp' && bytes.length > 30) {
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) { // VP8X
      return {
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      };
    }
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x4C) { // VP8L
      const b = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
      return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 };
    }
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x20) { // lossy VP8
      return { width: readUInt16BE(bytes, 26) & 0x3FFF, height: readUInt16BE(bytes, 28) & 0x3FFF };
    }
    return null;
  }
  return null;
}

function readUInt16BE(b, o) { return (b[o] << 8) | b[o + 1]; }
function readUInt32BE(b, o) {
  return ((b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0;
}

function buildPictureCertificateHtml(lang, name, bg, m, x) {
  const c = CERT_PIC_COPY[lang];
  const dir = c.rtl ? 'rtl' : 'ltr';
  // Sizes scale with the picture width so other picture sizes keep the layout.
  const k = bg.width / 2918;
  const px = function (v) { return Math.round(v * k); };
  const arabicFont = "'Noto Naskh Arabic','Geeza Pro','Segoe UI',Tahoma,sans-serif";
  const latinFont = "'Segoe UI','Open Sans',Arial,sans-serif";
  const layer = function (y, text, cls, extra) {
    return '<div class="layer ' + cls + '" style="bottom:' + px(y) + 'px;' + (extra || '') + '">' + escHtml(text) + '</div>';
  };
  return '<!DOCTYPE html><html lang="' + lang + '" dir="' + dir + '"><head><meta charset="utf-8">'
    + '<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Aref+Ruqaa:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&family=Playfair+Display:ital,wght@0,700;1,700&display=swap" rel="stylesheet">'
    + '<style>'
    + '@page { size: ' + (bg.width * 25.4 / 96).toFixed(2) + 'mm ' + (bg.height * 25.4 / 96).toFixed(2) + 'mm; margin: 0; }'
    + 'html,body { margin:0; padding:0; }'
    + 'body { width:' + bg.width + 'px; height:' + bg.height + 'px; position:relative; overflow:hidden; }'
    + 'img.bg { position:absolute; top:0; left:0; width:100%; height:100%; }'
    + '.layer { position:absolute; left:9%; right:9%; text-align:center; line-height:1.2; font-family:' + (c.rtl ? arabicFont : latinFont) + '; }'
    + '.t-title { color:#1f4f63; font-weight:700; font-size:' + px(CERT_PIC_FONT.title) + 'px; }'
    + '.t-name { color:#1b4a5e; font-weight:700; font-size:' + px(CERT_PIC_FONT.name) + 'px;'
    + " font-family:'Playfair Display','Amiri','Noto Naskh Arabic',Georgia,serif;"
    + (c.rtl ? '' : ' font-style:italic; letter-spacing:' + px(1.5) + 'px;')
    + ' text-shadow:0 ' + px(2) + 'px ' + px(5) + 'px rgba(201,162,39,0.3); }'
    + '.t-dua { color:#2a4f5e; font-weight:500; font-size:' + px(CERT_PIC_FONT.dua) + 'px; }'
    + '.t-thanks { white-space:nowrap; color:#a8842a; font-weight:700; font-size:' + px(CERT_PIC_FONT.thanks) + 'px;'
    + ' font-family:' + (c.rtl ? "'Amiri','Noto Naskh Arabic','Geeza Pro',serif" : "'Aref Ruqaa','Amiri',serif") + '; }'
    + '</style></head><body>'
    + '<img class="bg" src="' + bg.dataUri + '">'
    + layer(CERT_PIC_POS.title, c.title, 't-title')
    + layer(CERT_PIC_POS.name, name, 't-name')
    + layer(CERT_PIC_POS.dua1, c.dua1(m), 't-dua')
    + layer(CERT_PIC_POS.dua2, c.dua2(x), 't-dua')
    + layer(CERT_PIC_POS.thanks, c.thanks, 't-thanks', c.thanksSize ? 'font-size:' + px(c.thanksSize) + 'px;' : '')
    + '</body></html>';
}

// ── Helpers ───────────────────────────────────────────────────

function getOrCreateFolder(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
