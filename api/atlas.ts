import { ATLAS_CURRICULUM } from '../shared/atlas/manifest.js';

export interface PreviewAtlasResponse {
  status: number;
  body: unknown;
}

export async function previewAtlasResponse(path: string, method: string): Promise<PreviewAtlasResponse> {
  const route = path.replace(/^\/+|\/+$/g, '');
  if (method !== 'GET') {
    return { status: route.startsWith('orders') ? 503 : 405, body: route.startsWith('orders') ? { ok: false, error: 'Atlas preview is read-only.' } : { ok: false, error: 'Method not allowed.' } };
  }
  if (route === 'bootstrap') return { status: 200, body: { ok: true, data: { product: 'nim-atlas', campaignMode: 'local-first', competitiveExpeditions: false, walletRequired: false, curriculumVersion: 1 } } };
  if (route === 'curriculum') return { status: 200, body: { ok: true, data: structuredClone(ATLAS_CURRICULUM) } };
  if (route === 'beacon') return { status: 503, body: { ok: false, error: 'Atlas Beacon is unavailable in preview.' } };
  if (route === 'echoes') return { status: 503, body: { ok: false, error: 'Atlas Echoes are unavailable in preview.' } };
  if (route === 'competition') return { status: 503, body: { ok: false, error: 'Atlas competition is unavailable in preview.' } };
  if (route.startsWith('orders')) return { status: 503, body: { ok: false, error: 'Atlas preview is read-only.' } };
  return { status: 404, body: { ok: false, error: 'Atlas route was not found.' } };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const result = await previewAtlasResponse(requestUrl.searchParams.get('route') ?? '', request.method);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
