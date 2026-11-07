// Small HTTP helpers shared by the functions: upstream fetch with a timeout and
// browser-like headers (the exchanges reject bare requests), JSON responses,
// and a TTL memory cache that survives while the function instance is warm.

export const BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36',
};

export class UpstreamError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export async function fetchJson<T = unknown>(url: string | URL, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, headers, ...rest } = init;
  const response = await fetch(url, { ...rest, headers: { ...BROWSER_HEADERS, ...(headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new UpstreamError(`${new URL(String(url)).host} returned ${response.status}`, response.status);
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!contentType.includes('json') && !body.trim().startsWith('{') && !body.trim().startsWith('[')) {
    throw new UpstreamError(`${new URL(String(url)).host} did not return JSON`);
  }
  try { return JSON.parse(body) as T; } catch { throw new UpstreamError(`${new URL(String(url)).host} returned invalid JSON`); }
}

export const json = (body: unknown, { status = 200, maxAge = 0, swr = 0, extra = {} as Record<string, string> } = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}${swr ? `, stale-while-revalidate=${swr}` : ''}` : 'no-store',
      // Let Netlify's CDN serve repeat requests without invoking the function.
      ...(maxAge > 0 && status === 200 ? { 'netlify-cdn-cache-control': `public, max-age=${maxAge}${swr ? `, stale-while-revalidate=${swr}` : ''}, durable` } : {}),
      ...extra,
    },
  });

export const errorResponse = (error: unknown, fallback = 'Upstream request failed'): Response => {
  const message = error instanceof Error ? error.message : fallback;
  const status = error instanceof UpstreamError ? 502 : 500;
  return json({ error: message }, { status });
};

interface CacheEntry<T> { value: T; expires: number; storedAt: number }

/** Memory cache with TTL; `stale()` returns an expired value for graceful degradation. */
export class MemoryCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 200) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) return undefined;
    return entry.value;
  }
  stale(key: string): T | undefined { return this.entries.get(key)?.value; }
  storedAt(key: string): number | undefined { return this.entries.get(key)?.storedAt; }
  set(key: string, value: T, ttlMs = this.ttlMs): T {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: Date.now() + ttlMs, storedAt: Date.now() });
    return value;
  }
}

/** Run async tasks with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await task(items[index], index) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}

export const TICKER = /^\d{4}$/;
export const asMarket = (value: string | null): 'TWSE' | 'TPEx' => (value === 'TPEx' ? 'TPEx' : 'TWSE');
