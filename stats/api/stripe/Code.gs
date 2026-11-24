function doGet() {
  const spreadsheetId = "1l6m_YvqHmiCh588wggdjZiUwyeGzW3H5srrzFAa74WI";
  const sheet = SpreadsheetApp.openById(spreadsheetId)
    .getSheetByName('stripe_donations');

  const values = sheet.getDataRange().getValues();
  values.shift(); // remove header row

  const total = values.reduce((sum, row) => sum + (Number(row[0]) || 0), 0);

  return ContentService.createTextOutput(
    JSON.stringify({ total_stripe: total })
  ).setMimeType(ContentService.MimeType.JSON);
}
