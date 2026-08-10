import { applyPendingStartupConfig } from './bootstrap';

const applied = applyPendingStartupConfig();
if (applied.length > 0) console.log(`[sface] applied ${applied.length} pending admin setting(s) before startup`);
await import('./index');
