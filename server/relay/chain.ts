export interface RelayChainObservation {
  network: 'main' | 'test';
  hash: string;
  blockHeight: number | null;
  confirmations: number;
  sender: string;
  recipient: string;
  valueLuna: number;
  success: boolean;
  canonical: boolean;
}

export interface RelayChainReader {
  observe(hash: string): Promise<RelayChainObservation | null>;
}

interface RelayRpcResponse { result?: unknown; error?: unknown; }
type RelayFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createNimiqRelayChainReader(options: { network: 'main' | 'test'; rpcUrls: readonly string[]; minConfirmations: number; fetchImpl?: RelayFetch; timeoutMs?: number }): RelayChainReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  return {
    async observe(hash) {
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(hash)) return null;
      for (const rpcUrl of options.rpcUrls) {
        try {
          const raw = await rpc(fetchImpl, rpcUrl, 'getTransaction', [hash], timeoutMs);
          const details = recordFromResult(raw);
          if (!details) continue;
          const blockHeight = integer(details.blockHeight ?? details.block_height);
          const transactionHash = stringValue(details.hash ?? details.transactionHash) ?? hash;
          const sender = stringValue(details.sender ?? details.from);
          const recipient = stringValue(details.recipient ?? details.to);
          const valueLuna = integer(details.value ?? details.valueLuna);
          const success = typeof details.success === 'boolean' ? details.success : details.status === 'success' ? true : details.status === 'failed' ? false : null;
          const canonical = typeof details.canonical === 'boolean' ? details.canonical : typeof details.isCanonical === 'boolean' ? details.isCanonical : null;
          if (!sender || !recipient || valueLuna === null || success === null || canonical === null) continue;
          const explicitConfirmations = integer(details.confirmations);
          let confirmations = explicitConfirmations ?? 0;
          if (explicitConfirmations === null && blockHeight !== null) {
            const head = recordFromResult(await rpc(fetchImpl, rpcUrl, 'getLatestBlock', [false], timeoutMs));
            const headHeight = integer(head?.number ?? head?.height ?? head?.blockHeight);
            if (headHeight !== null) confirmations = Math.max(0, headHeight - blockHeight + 1);
          }
          return { network: details.network === 'main' || details.network === 'test' ? details.network : options.network, hash: transactionHash, blockHeight, confirmations, sender, recipient, valueLuna, success, canonical };
        } catch {
          // A failed node is not evidence of a missing or failed transaction. Try the next configured reader.
        }
      }
      return null;
    },
  };
}

async function rpc(fetchImpl: RelayFetch, url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) throw new Error('relay_rpc_http_error');
    const payload = await response.json() as RelayRpcResponse;
    if (payload.error !== undefined || payload.result === undefined) throw new Error('relay_rpc_error');
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

function recordFromResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nested = record.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : record;
}

function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function integer(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
