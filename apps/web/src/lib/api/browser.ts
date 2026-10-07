import { createApiClient, type Transport } from './client';

/**
 * Browser-side client: relative `/api` URLs (Next rewrites them to the API
 * origin) and same-origin credentials. No `process.env` and no cookie access,
 * so the API origin never reaches the browser bundle.
 */
const transport: Transport = {
  baseUrl: '/api',
  defaultInit: { credentials: 'same-origin', cache: 'no-store' },
};

export const api = createApiClient(transport);
