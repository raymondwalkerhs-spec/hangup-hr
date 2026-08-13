const googleSheets = require("./lib/google-sheets");
(async () => {
  try {
    const id = googleSheets.resolveSpreadsheetId();
    const tab = googleSheets.resolveTab();
    const range = `'${tab}'!A1:Z2`;
    const rows = await googleSheets.readSheet(id, range);
    console.log("OK", tab, rows[0] ? rows[0].length : 0, "headers");
    console.log("ROW2_COLS", rows[1] ? rows[1].length : 0);
  } catch (e) {
    console.error("ERR", e.message);
  }
})();
