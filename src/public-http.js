// @ts-check
// Public HTTPS intake. No environment proxy, pooled connection, or second DNS
// lookup may replace the addresses checked for this request.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export const MAX_REMOTE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;

const publicSpace = new BlockList();
publicSpace.addSubnet("0.0.0.0", 0, "ipv4");
publicSpace.addSubnet("2000::", 3, "ipv6");
const specialSpace = new BlockList();
// Conservative special-use exclusions; mapped IPv6 is also checked against
// these IPv4 subnets by Node's BlockList.
for (const [address, prefix] of /** @type {[string, number][]} */ ([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
])) specialSpace.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of /** @type {[string, number][]} */ ([
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
])) specialSpace.addSubnet(address, prefix, "ipv6");

/** @param {string} address */
export function isPrivateAddress(address) {
  const family = isIP(address);
  if (!family || address.includes("%")) return true;
  const type = family === 4 ? "ipv4" : "ipv6";
  return !publicSpace.check(address, type) || specialSpace.check(address, type);
}

/** @typedef {import('node:dns').LookupAddress} Address */
/** @typedef {(host: string, options: {all: true, verbatim: true}) => Promise<Address[]>} Lookup */
/** @typedef {Pick<Response, 'status' | 'ok' | 'headers' | 'body'>} HttpResponse */
/** @typedef {{lookup?: Lookup, fetch?: (url: URL, options: RequestInit) => Promise<HttpResponse>, request?: typeof httpsRequest}} Dependencies */

/** @param {string} input @param {Dependencies} dependencies */
async function resolvePublicUrl(input, dependencies) {
  let url;
  try { url = new URL(input); }
  catch { throw new Error("learning URL must be a valid HTTPS URL"); }
  if (url.protocol !== "https:") throw new Error("learning URLs must use HTTPS");
  if (url.username || url.password) throw new Error("learning URLs must not contain credentials");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || /\.(localhost|local|internal)$/.test(hostname)) {
    throw new Error("learning URLs must use a public host");
  }
  /** @type {Address[]} */
  let addresses;
  try {
    const family = isIP(hostname);
    addresses = family ? [{ address: hostname, family }]
      : dependencies.lookup ? await dependencies.lookup(hostname, { all: true, verbatim: true })
      : await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error("could not resolve learning URL host", { cause: error });
  }
  if (!addresses.length || addresses.some(({ address, family }) =>
    isPrivateAddress(address) || family !== isIP(address))) {
    throw new Error("learning URLs must not resolve to private or local addresses");
  }
  return { url, addresses };
}

/** @param {string} input @param {Dependencies} [dependencies] */
export async function assertPublicHttpsUrl(input, dependencies = {}) {
  return (await resolvePublicUrl(input, dependencies)).url;
}

/** @template T @param {Promise<T>} operation @param {AbortSignal} signal */
function untilAborted(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** @param {URL} url @param {Address[]} addresses @param {AbortSignal} signal @param {typeof httpsRequest} request */
function requestPinned(url, addresses, signal, request) {
  return new Promise(/** @param {(response: HttpResponse) => void} resolve */ (resolve, reject) => {
    const req = request(url, {
      agent: false,
      signal,
      // Preserve the URL hostname for Host, SNI, and certificate verification.
      // Node may ask for one address or for all addresses for family selection.
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      headers: {
        accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        "user-agent": "DIRF-Learn/1.0 (+local research ingestion)",
      },
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const status = response.statusCode || 0;
      resolve({ status, ok: status >= 200 && status < 300, headers,
        body: /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(response)) });
    });
    req.on("error", reject);
    req.end();
  });
}

/** @param {HttpResponse} response @param {number} maxBytes @param {AbortSignal} signal */
async function readResponseBytes(response, maxBytes, signal) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await untilAborted(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) throw new Error(`learning URL exceeds the ${maxBytes} byte limit`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", abort);
    // Cancellation may itself stall in a custom stream; never extend the deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * One deadline covers DNS, every redirect, headers, and the complete body.
 * Dependency overrides are trusted test seams, never URL-controlled inputs.
 * @param {string} input
 * @param {{maxBytes?: number, timeoutMs?: number}} [options]
 * @param {Dependencies} [dependencies]
 */
export async function fetchTextSafely(input, options = {}, dependencies = {}) {
  const maxBytes = options.maxBytes ?? MAX_REMOTE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("learning limits must be positive integers within the timer range");
  }
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(new Error(`learning URL timed out after ${timeoutMs} ms`)), timeoutMs);
  let current = input;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const { url, addresses } = await untilAborted(resolvePublicUrl(current, dependencies), signal);
      signal.throwIfAborted();
      const pending = dependencies.fetch
        ? dependencies.fetch(url, { redirect: "manual", signal })
        : requestPinned(url, addresses, signal, dependencies.request || httpsRequest);
      // Dispose even a late response from an injected transport that ignores abort.
      void pending.then((response) => {
        if (signal.aborted) void response.body?.cancel().catch(() => {});
      }, () => {});
      const response = await untilAborted(pending, signal);
      try {
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error(`learning URL redirect ${response.status} had no location`);
          if (redirects === MAX_REDIRECTS) throw new Error("learning URL exceeded the redirect limit");
          current = new URL(location, url).toString();
          continue;
        }
        if (!response.ok) throw new Error(`learning URL returned HTTP ${response.status}`);
        if (Number(response.headers.get("content-length") || 0) > maxBytes) {
          throw new Error(`learning URL exceeds the ${maxBytes} byte limit`);
        }
        const encoding = response.headers.get("content-encoding");
        if (encoding && encoding.toLowerCase() !== "identity") throw new Error("learning URL returned an unsupported content encoding");
        const bytes = await readResponseBytes(response, maxBytes, signal);
        return { body: bytes.toString("utf8"), bytes,
          contentType: response.headers.get("content-type") || "application/octet-stream",
          finalUrl: url.toString() };
      } finally {
        if (!response.body?.locked) void response.body?.cancel().catch(() => {});
      }
    }
    throw new Error("learning URL exceeded the redirect limit");
  } finally {
    clearTimeout(timer);
  }
}
