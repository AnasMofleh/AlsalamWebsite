function testDoPost() {
  // Simulate what the Android app POSTs
  var mockEvent = {
    postData: {
      contents: JSON.stringify({
        rows: [
          {
            date: "2026-06-10",
            time: "14:30:00",
            account: "Test Account",
            amount: "100",
            message: "Test payment",
            sourceTimestamp: "2026-06-10T12:30:00.123Z"
          }
        ]
      }),
      type: "application/json"
    }
  };

  var result = doPost(mockEvent);
  Logger.log("Response: " + result.getContent());
  
  // Also check the sheet
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (sheet && sheet.getLastRow() > 0) {
    var lastRow = sheet.getRange(sheet.getLastRow(), 1, 1, 5).getValues()[0];
    Logger.log("Last sheet row: " + JSON.stringify(lastRow));
  }
}
