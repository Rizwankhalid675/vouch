// One public GET, and what came back.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.

import type { FetchLike } from "./types.ts";

/**
 * What came back from one public GET -- as a discriminated union, deliberately.
 *
 * THIS IS THE STRUCTURAL FIX, and it is upstream of four rounds of the same bug.
 *
 * It used to be one shape with `status: number | null` and an optional `error`,
 * so `fetched.json` compiled on a request that never got an answer and quietly
 * read `undefined`. Every instance of this project's longest-running defect was
 * that one line: a body read off a request that never arrived, turned into a
 * statement about the site. Three rounds of "find the reader and guard it" each
 * left another reader behind, because nothing stopped the next one being written.
 *
 * Now there is nothing to read. A `NoAnswer` has no `status`, no `json`, no
 * headers and no body, and no fields for them, so `fetched.json` is a COMPILE
 * ERROR until the caller has narrowed on `outcome`. The next instance of this
 * class cannot be written; the compiler objects before a reviewer has to.
 */
export type Fetched = Answered | NoAnswer;

export interface Answered {
  readonly outcome: "answered";
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  /** `Access-Control-Allow-Origin` exactly as the server sent it, or null when absent. */
  readonly allowOrigin: string | null;
  readonly text: string;
  /** The parsed body, when it parsed as JSON. */
  readonly json?: unknown;
  /** Why the body is not usable JSON, when it is not. */
  readonly jsonError?: string;
}

export interface NoAnswer {
  readonly outcome: "no-answer";
  readonly url: string;
  /**
   * The transport error. This is the ONLY thing known about this request, and a
   * site cannot be at fault for a request that never arrived, so it is the only
   * thing anything downstream may say about it.
   */
  readonly error: string;
}

/** Narrowing helper, for the places that filter a list. */
export const answered = (f: Fetched): f is Answered => f.outcome === "answered";

export async function getArtifact(
  url: string,
  fetchImpl: FetchLike,
  probeOrigin: string,
  timeoutMs: number,
): Promise<Fetched> {
  const headers = {
    accept: "application/json, */*",
    origin: probeOrigin,
    // A CDN serving a previous build is the classic way to "verify" something that is
    // not deployed, and this tool's whole value is that it reads a real response. So
    // every GET asks for a fresh one. `Pragma` is sent alongside `Cache-Control`
    // because HTTP/1.0 caches and a few proxies still honour only the older header.
    //
    // NOT a query cache-buster, deliberately: §3.2 derives the network name from the
    // final path component of the URL under test, so appending `?cb=…` would change
    // the thing being tested -- and on a static host it can also miss the cache
    // entirely and be served from a different path than the one a visitor gets.
    //
    // And what this does NOT buy, because the tool must not overstate its own reach:
    // a request header is a REQUEST for freshness. An edge cache configured to ignore
    // it will still serve a stale object, and nothing a client sends can force
    // otherwise. The README says so, and `docs/RESULTS.md` keeps a manual
    // cache-busting `curl` beside the CLI for exactly that case.
    "cache-control": "no-cache",
    pragma: "no-cache",
  };
  let response: Response;
  try {
    response = await withTimeout(fetchImpl(url, { headers }), timeoutMs, url);
  } catch (err) {
    return { outcome: "no-answer", url, error: err instanceof Error ? err.message : String(err) };
  }

  const contentType = response.headers.get("content-type");
  const allowOrigin = response.headers.get("access-control-allow-origin");
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    // The headers arrived and the body did not. That IS an answer -- the status and
    // the CORS header are real and checkable -- so it is not a `no-answer`.
    return {
      outcome: "answered",
      url,
      status: response.status,
      contentType,
      allowOrigin,
      text: "",
      jsonError: `body unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const base = { outcome: "answered", url, status: response.status, contentType, allowOrigin, text } as const;
  if (!response.ok) return base;
  try {
    return { ...base, json: JSON.parse(text) };
  } catch (err) {
    return { ...base, jsonError: err instanceof Error ? err.message : String(err) };
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
  if (fetched.outcome === "no-answer") return `${fetched.url}: ${fetched.error}`;
  const parts = [`HTTP ${fetched.status}`];
  if (fetched.contentType) parts.push(fetched.contentType.split(";")[0]!.trim());
  if (fetched.jsonError) parts.push(`body is not JSON: ${fetched.jsonError}`);
  return `${fetched.url}: ${parts.join(", ")}`;
}
