/**
 * Google Apps Script — Receipt Upload Handler
 *
 * Handles uploading receipt files to Google Drive under the "receipts" folder.
 *
 * Folder structure created automatically:
 *   receipts / YYYY / category /
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
 * 5. Update GAS_URL in admin/index.html with the copied URL
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

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    usage: 'POST with action=upload-receipt'
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
