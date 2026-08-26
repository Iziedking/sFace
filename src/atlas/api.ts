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

export interface AtlasApiClient {
  getBootstrap(): Promise<AtlasBootstrapSummary>;
  getBeacon(): Promise<AtlasBeaconSummary>;
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
