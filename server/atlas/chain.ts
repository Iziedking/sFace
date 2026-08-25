export interface AtlasChainObservation {
  lookup: string;
  network: 'testalbatross' | 'mainalbatross';
  blockHeight: number | null;
  confirmations: number;
  sender: string;
  recipient: string;
  valueLuna: number;
  success: boolean;
  canonical: boolean;
  reorgDetected?: boolean;
}

export interface AtlasChainReader {
  observe(lookup: string): Promise<AtlasChainObservation | null>;
}

interface RpcResponse { result?: unknown; error?: unknown; }
type AtlasFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createAtlasChainReader(options: {
  network: 'testalbatross' | 'mainalbatross';
  rpcUrls: readonly string[];
  minConfirmations: number;
  fetchImpl?: AtlasFetch;
  timeoutMs?: number;
}): AtlasChainReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    async observe(lookup) {
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(lookup)) return null;
      for (const rpcUrl of options.rpcUrls) {
        try {
          const result = record(await rpc(fetchImpl, rpcUrl, 'getTransactionByHash', [lookup], timeoutMs));
          if (!result) continue;
          const blockHeight = integer(result.blockHeight ?? result.block_height);
          const hash = stringValue(result.hash ?? result.transactionHash) ?? lookup;
          const sender = stringValue(result.sender ?? result.from);
          const recipient = stringValue(result.recipient ?? result.to);
          const valueLuna = integer(result.value ?? result.valueLuna);
          const success = booleanOrStatus(result.success, result.status);
          const canonical = booleanOrStatus(result.canonical, result.isCanonical);
          if (!sender || !recipient || valueLuna === null || success === null || canonical === null) continue;
          const declaredConfirmations = integer(result.confirmations);
          let confirmations = declaredConfirmations ?? 0;
          if (declaredConfirmations === null && blockHeight !== null) {
            const head = record(await rpc(fetchImpl, rpcUrl, 'getLatestBlock', [false], timeoutMs));
            const headHeight = integer(head?.number ?? head?.height ?? head?.blockHeight);
            if (headHeight !== null) confirmations = Math.max(0, headHeight - blockHeight + 1);
          }
          const observation: AtlasChainObservation = { lookup: hash, network: options.network, blockHeight, confirmations, sender, recipient, valueLuna, success, canonical };
          if (result.reorgDetected === true) observation.reorgDetected = true;
          return observation;
        } catch {
          // A failed RPC is not evidence of a failed payment. Try the next configured reader.
        }
      }
      return null;
    },
  };
}

async function rpc(fetchImpl: AtlasFetch, url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error('atlas_rpc_http_error');
    const payload = await response.json() as RpcResponse;
    if (payload.error !== undefined || payload.result === undefined) throw new Error('atlas_rpc_error');
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const nested = raw.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : raw;
}

function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function integer(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function booleanOrStatus(value: unknown, status: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (status === 'success') return true;
  if (status === 'failed') return false;
  return null;
}
