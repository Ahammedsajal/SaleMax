'use strict';
require('dotenv').config({ silent: true });
const args = process.argv.slice(2);
if (args.length !== 1 || !['--dry-run', '--apply'].includes(args[0])) {
  console.error('Usage: node scripts/whatsapp-media-retention.cjs --dry-run|--apply');
  process.exit(2);
}
require('../helper/maintenance/whatsappRetention').runWhatsAppRetentionCleanup({ dryRun: args[0] === '--dry-run' })
  .then(result => { console.log(JSON.stringify(result)); process.exit(result.failedFiles ? 1 : 0); })
  .catch(error => { console.error(error.code || error.message); process.exit(1); });
