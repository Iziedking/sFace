export interface AtlasOrderSummary {
  id: string;
  status: string;
  lookup?: string | null;
  [key: string]: unknown;
}

export interface AtlasBootstrapSummary {
  product: 'nim-atlas';
  campaignMode: 'local-first';
  competitiveExpeditions: boolean;
  walletRequired: false;
  curriculumVersion: number;
}

export interface AtlasBeaconSummary {
  status: 'live' | 'stale' | 'unavailable';
  verifiedContributorCount: number;
  systems: Array<{ districtId: string; repairTotal: number; target: number; stage: number }>;
}

export interface AtlasEchoSummary {
  status: 'live' | 'stale' | 'unavailable';
  echoes: Array<{ id: string; districtId: string; action: string; cosmeticId: string; displayName: string; contributionDelta: number; observedAtBucket: number }>;
}

export interface AtlasCompetitionSummary {
  role: 'explorer' | 'builder';
  bestVerifiedScore: number | null;
  eligibility: 'eligible' | 'assisted' | 'not-verified';
  dailyObligation: { status: 'estimating' | 'pending' | 'verified-paid' | 'unawarded'; amountLuna: number | null };
}

export interface AtlasApiClient {
  getBootstrap(): Promise<AtlasBootstrapSummary>;
  getBeacon(): Promise<AtlasBeaconSummary>;
  getEchoes(): Promise<AtlasEchoSummary>;
  getCompetition(): Promise<AtlasCompetitionSummary[]>;
  createOrder(input: { actorId: string; walletAddress: string; itemId: 'harbor-lantern'; idempotencyKey?: string }): Promise<AtlasOrderSummary>;
  submitTransactionLookup(orderId: string, lookup: string): Promise<AtlasOrderSummary>;
  reconcileOrder(orderId: string): Promise<AtlasOrderSummary>;
  cancelOrder(orderId: string, reason: string): Promise<AtlasOrderSummary>;
  getOrder(orderId: string): Promise<AtlasOrderSummary>;
}

type AtlasFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createAtlasApiClient(options: { baseUrl?: string; fetchImpl?: AtlasFetch } = {}): AtlasApiClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    getBootstrap: () => requestData(fetchImpl, `${baseUrl}/atlas/api/bootstrap`, isBootstrap),
    getBeacon: () => requestData(fetchImpl, `${baseUrl}/atlas/api/beacon`, isBeacon),
    getEchoes: () => requestData(fetchImpl, `${baseUrl}/atlas/api/echoes`, isEchoes),
    getCompetition: () => requestData(fetchImpl, `${baseUrl}/atlas/api/competition`, isCompetition),
    createOrder: (input) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders`, { method: 'POST', body: input }),
    submitTransactionLookup: (orderId, lookup) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/transaction`, { method: 'POST', body: { lookup } }),
    reconcileOrder: (orderId) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/reconcile`, { method: 'POST' }),
    cancelOrder: (orderId, reason) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: { reason } }),
    getOrder: (orderId) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}`),
  };
}

async function requestOrder(fetchImpl: AtlasFetch, url: string, options: { method?: string; body?: unknown } = {}): Promise<AtlasOrderSummary> {
  return requestData(fetchImpl, url, isOrder, options);
}

async function requestData<T>(fetchImpl: AtlasFetch, url: string, guard: (value: unknown) => value is T, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new Error('Atlas service is unavailable.');
  }
  if (!response.ok) throw new Error(response.status >= 500 ? 'Atlas service is unavailable.' : 'Atlas request was rejected.');
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('Atlas service is unavailable.'); }
  if (!payload || typeof payload !== 'object' || (payload as { ok?: unknown }).ok !== true) throw new Error('Atlas service is unavailable.');
  const data = (payload as { data?: unknown }).data;
  if (!guard(data)) throw new Error('Atlas service is unavailable.');
  return structuredClone(data);
}

function isOrder(value: unknown): value is AtlasOrderSummary {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { status?: unknown }).status === 'string');
}

function isBootstrap(value: unknown): value is AtlasBootstrapSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.product === 'nim-atlas' && data.campaignMode === 'local-first' && typeof data.competitiveExpeditions === 'boolean' && data.walletRequired === false && Number.isSafeInteger(data.curriculumVersion);
}

function isBeacon(value: unknown): value is AtlasBeaconSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.status === 'live' || data.status === 'stale' || data.status === 'unavailable') && Number.isSafeInteger(data.verifiedContributorCount) && Array.isArray(data.systems);
}

function isEchoes(value: unknown): value is AtlasEchoSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (!['live', 'stale', 'unavailable'].includes(String(data.status)) || !Array.isArray(data.echoes)) return false;
  return data.echoes.every((echo) => {
    if (!echo || typeof echo !== 'object' || Array.isArray(echo)) return false;
    const item = echo as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.districtId === 'string' && typeof item.action === 'string' && typeof item.cosmeticId === 'string' && typeof item.displayName === 'string' && Number.isSafeInteger(item.contributionDelta) && Number.isSafeInteger(item.observedAtBucket);
  });
}

function isCompetition(value: unknown): value is AtlasCompetitionSummary[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const summary = item as Record<string, unknown>;
    const obligation = summary.dailyObligation;
    if (!obligation || typeof obligation !== 'object' || Array.isArray(obligation)) return false;
    const daily = obligation as Record<string, unknown>;
    return (summary.role === 'explorer' || summary.role === 'builder')
      && (summary.bestVerifiedScore === null || Number.isSafeInteger(summary.bestVerifiedScore))
      && ['eligible', 'assisted', 'not-verified'].includes(String(summary.eligibility))
      && ['estimating', 'pending', 'verified-paid', 'unawarded'].includes(String(daily.status))
      && (daily.amountLuna === null || Number.isSafeInteger(daily.amountLuna));
  });
}
