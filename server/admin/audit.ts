const AUDIT_EVENTS = new Set([
  'login_success',
  'login_failed',
  'login_ip_denied',
  'backup_created',
  'backup_failed',
  'diagnostics_exported',
  'records_read',
  'config_changed',
  'secret_replaced',
  'restart_requested',
  'assisted_migration',
]);

export function isAuditEvent(event: string): boolean {
  return AUDIT_EVENTS.has(event);
}
