const Database = require('better-sqlite3');
const db = new Database('C:/Users/rajdi/llm_council/server/data/freeapi.db');

try {
  console.log("=== RECENT ERRORS IN REQUESTS LOGS ===");
  const errors = db.prepare("SELECT id, platform, model_id, status, error, created_at FROM requests WHERE status = 'error' ORDER BY created_at DESC LIMIT 10").all();
  console.log(JSON.stringify(errors, null, 2));
} catch (e) {
  console.error("Error fetching request logs:", e);
} finally {
  db.close();
}
