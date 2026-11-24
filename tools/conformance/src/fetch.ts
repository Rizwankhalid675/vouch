// One public GET, and what came back.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.

import type { FetchLike } from "./types.ts";

export interface Fetched {
  readonly url: string;
  /** HTTP status, or null when the request never completed. */
  readonly status: number | null;
  /** The transport error, when there was one. */
  readonly error?: string;
  readonly contentType: string | null;
  /** `Access-Control-Allow-Origin` exactly as the server sent it, or null when absent. */
  readonly allowOrigin: string | null;
  readonly text: string | null;
  /** The parsed body, when it parsed as JSON. */
  readonly json?: unknown;
  /** Why the body is not usable JSON, when it is not. */
  readonly jsonError?: string;
}

/**
 * Fetches a public agent artifact the way a browser on another origin would.
 *
 * Two details matter more than they look:
 *
 *  - **The Origin header is sent.** A host may emit
 *    `Access-Control-Allow-Origin` only when a request carries `Origin`. A probe
 *    that omits it reads "no CORS" off a correctly configured host, or worse,
 *    reads a pass off one that would refuse a real caller.
 *  - **No credentials, ever.** §3.4: "Public artifact requests MUST NOT include
 *    the caller's private credentials." Nothing here sends a cookie, an
 *    Authorization header, or a key, and the tool accepts none to send.
 */
export async function getArtifact(
  url: string,
  fetchImpl: FetchLike,
  probeOrigin: string,
  timeoutMs: number,
): Promise<Fetched> {
  const headers = { accept: "application/json, */*", origin: probeOrigin };
  let response: Response;
  try {
    response = await withTimeout(fetchImpl(url, { headers }), timeoutMs, url);
  } catch (err) {
    return {
      url,
      status: null,
      error: err instanceof Error ? err.message : String(err),
      contentType: null,
      allowOrigin: null,
      text: null,
    };
  }

  const contentType = response.headers.get("content-type");
  const allowOrigin = response.headers.get("access-control-allow-origin");
  let text: string | null = null;
  try {
    text = await response.text();
  } catch (err) {
    return {
      url,
      status: response.status,
      error: `body unreadable: ${err instanceof Error ? err.message : String(err)}`,
      contentType,
      allowOrigin,
      text: null,
    };
  }

  if (!response.ok) {
    return { url, status: response.status, contentType, allowOrigin, text };
  }
  try {
    return { url, status: response.status, contentType, allowOrigin, text, json: JSON.parse(text) };
  } catch (err) {
    return {
      url,
      status: response.status,
      contentType,
      allowOrigin,
      text,
      jsonError: err instanceof Error ? err.message : String(err),
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no response from ${url} within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** A one-line description of what came back, for a finding. */
export function describe(fetched: Fetched): string {
  if (fetched.error) return `${fetched.url}: ${fetched.error}`;
  const parts = [`HTTP ${fetched.status}`];
  if (fetched.contentType) parts.push(fetched.contentType.split(";")[0]!.trim());
  if (fetched.jsonError) parts.push(`body is not JSON: ${fetched.jsonError}`);
  return `${fetched.url}: ${parts.join(", ")}`;
}
