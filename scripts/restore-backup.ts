import { join } from 'node:path';
import { restoreBackup } from '../server/restore-backup';

const backupName = process.argv[2] ?? '';
if (!backupName) {
  console.error('Usage: npm run restore:backup -- sface.json.<label>.bak');
  process.exitCode = 2;
} else {
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), '.data');
  try {
    const result = await restoreBackup(dataDir, backupName);
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
