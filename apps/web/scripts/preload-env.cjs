// Loaded via `tsx --require` before worker.ts's own imports evaluate — this must run before
// anything that reads process.env at module scope (e.g. lib/db/client.ts's DATABASE_URL check),
// which a dotenv import placed inside worker.ts itself cannot guarantee: ESM import evaluation
// order doesn't reliably run interleaved statements before later imports the way CJS require
// does. A `--require` preload script is the one ordering Node actually guarantees.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
