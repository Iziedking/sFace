export interface AdminConfigEntry {
  key: string;
  configured: boolean;
  secret: boolean;
  restartRequired: boolean;
}

const DEFINITIONS: readonly Omit<AdminConfigEntry, 'configured'>[] = [
  { key: 'ADMIN_TOKEN', secret: true, restartRequired: true },
  { key: 'ADMIN_ALLOWED_IPS', secret: false, restartRequired: true },
  { key: 'GIT_COMMIT', secret: false, restartRequired: false },
  { key: 'ALLOWED_ORIGINS', secret: false, restartRequired: true },
  { key: 'TRUST_PROXY', secret: false, restartRequired: true },
  { key: 'ANCHOR_ADDRESS', secret: false, restartRequired: true },
  { key: 'X_CLIENT_ID', secret: true, restartRequired: true },
  { key: 'X_CLIENT_SECRET', secret: true, restartRequired: true },
  { key: 'X_BEARER_TOKEN', secret: true, restartRequired: true },
  { key: 'XAI_API_KEY', secret: true, restartRequired: true },
  { key: 'SFACE_TREASURY', secret: false, restartRequired: true },
];

export function configInventory(env: Readonly<Record<string, string | undefined>> = process.env): AdminConfigEntry[] {
  return DEFINITIONS.map((definition) => ({
    ...definition,
    configured: Boolean(env[definition.key]?.trim()),
  }));
}
