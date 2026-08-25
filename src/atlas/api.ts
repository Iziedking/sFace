export interface AtlasOrderSummary {
  id: string;
  status: string;
  lookup?: string | null;
  [key: string]: unknown;
}

export interface AtlasApiClient {
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
    createOrder: (input) => request(fetchImpl, `${baseUrl}/atlas/api/orders`, { method: 'POST', body: input }),
    submitTransactionLookup: (orderId, lookup) => request(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/transaction`, { method: 'POST', body: { lookup } }),
    reconcileOrder: (orderId) => request(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/reconcile`, { method: 'POST' }),
    cancelOrder: (orderId, reason) => request(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: { reason } }),
    getOrder: (orderId) => request(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}`),
  };
}

async function request(fetchImpl: AtlasFetch, url: string, options: { method?: string; body?: unknown } = {}): Promise<AtlasOrderSummary> {
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
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as { id?: unknown }).id !== 'string' || typeof (data as { status?: unknown }).status !== 'string') throw new Error('Atlas service is unavailable.');
  return structuredClone(data) as AtlasOrderSummary;
}
