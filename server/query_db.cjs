const database = require('better-sqlite3');
const db = database('C:/Users/rajdi/freellmapi/server/data/freeapi.db');
const models = db.prepare("SELECT id, platform, model_id, display_name, enabled FROM models WHERE model_id LIKE '%gemini%' OR platform = 'google'").all();
console.log(JSON.stringify(models, null, 2));
