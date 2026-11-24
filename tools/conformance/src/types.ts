// agentic-web-conformance — shared types.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
// See the LICENSE and NOTICE files alongside this directory.

import type { NoAnswer } from "./fetch.ts";

/**
 * The three things a conformance tool can honestly say about a requirement.
 *
 * `not-demonstrated` is not a hedge and not a soft fail. It is the statement
 * "this cannot be checked from here", which is different from "I looked and it
 * is wrong" and different again from "I did not look". Collapsing the three is
 * the failure mode this tool exists to avoid, so there is no fourth value and
 * no "warning": a check either passed, failed, or was not made.
 */
export type CheckStatus = "pass" | "fail" | "not-demonstrated";

/**
 * For a check that was not made: whose limitation is the reason.
 *
 * A publisher reading the output has to be able to tell, without reading this
 * source, whether the tool declined (it cannot drive a browser) or the site
 * declined (it does not offer the thing) — or both, which is a real case and
 * not a fudge: see the `run-default-router` check.
 */
export type Blocker = "checker" | "site" | "checker-and-site";

interface CheckIdentity {
  /** Stable id, safe to grep in CI output. */
  readonly check: string;
  /** One short line a publisher reads. */
  readonly title: string;
  /** The section of the MVP profile this check is taken from, e.g. "§3.3". */
  readonly section: string;
  /** Why this status, in one sentence. On a check not made, what would be needed instead. */
  readonly detail: string;
}

/**
 * A check that was MADE: a document was read and a conclusion reached about it.
 *
 * `findings` is the evidence. On a failure: the offending values, each with the
 * JSON path or URL it was found at, so the output is actionable without
 * re-running anything. On a pass: what was actually observed, so a pass is also
 * checkable. Never a credential — a report gets pasted into issues and CI logs.
 */
export interface MadeCheck extends CheckIdentity {
  readonly kind: "made";
  readonly status: "pass" | "fail";
  readonly findings: readonly string[];
}

/**
 * A check DECLINED although the artifacts were readable: it needs a browser, a
 * running agent loop or a live model, which a command line does not have.
 *
 * This one may carry findings, because its documents were read: quoting what the
 * manifest declares is a statement backed by a document that answered.
 */
export interface DeclinedCheck extends CheckIdentity {
  readonly kind: "declined";
  readonly status: "not-demonstrated";
  readonly blockedBy: Blocker;
  readonly findings: readonly string[];
}

/**
 * A check not made because a request got NO ANSWER.
 *
 * THIS TYPE IS THE STRUCTURAL FIX, and the shape of it is the whole point.
 *
 * It has **no `findings` field**. Not an empty one — none. For four rounds the
 * same defect kept coming back in a new channel: a body read off a request that
 * never arrived and turned into a statement about the site. Each round found the
 * reader and guarded it, and the next round found another, because nothing
 * prevented one being written. The last instance printed, on two adjacent lines
 * of one result, "Nothing here is a statement about the site" and then
 * "- manifest declares no llm_router".
 *
 * So there is nowhere to put that. A caller who tries gets a compile error, not a
 * reviewer. Three further invariants are types rather than conventions:
 *
 *  - `blockedBy` is the literal `"checker"`. A site that received no request has
 *    not blocked anything and cannot be named as a reason; `"checker-and-site"`
 *    here is a compile error, and stays available for the case it was invented
 *    for, where both genuinely apply.
 *  - `unreachedUrl` is REQUIRED. "Every unreached result names its artifact" is
 *    what makes the report's headline count a count of observations rather than a
 *    coincidence, so it cannot be omitted.
 *  - `transport` is the error, and it is the only thing known about this request.
 *
 * The companion half of the fix is in `fetch.ts`: a `NoAnswer` has no body to
 * read in the first place.
 */
export interface UnreachedCheck extends CheckIdentity {
  readonly kind: "unreached";
  readonly status: "not-demonstrated";
  readonly blockedBy: "checker";
  readonly unreachedUrl: string;
  readonly transport: string;
}

export type CheckResult = MadeCheck | DeclinedCheck | UnreachedCheck;

/** Findings, or none at all for a check whose artifact never answered. */
export const findingsOf = (result: CheckResult): readonly string[] =>
  result.kind === "unreached" ? [] : result.findings;

export const isUnreached = (result: CheckResult): result is UnreachedCheck => result.kind === "unreached";

/** The blocker, or undefined for a check that was made. */
export const blockerOf = (result: CheckResult): Blocker | undefined =>
  result.kind === "made" ? undefined : result.blockedBy;

/** Every sentence a result makes, through every channel it has. */
export function statementsOf(result: CheckResult): string[] {
  const out = [result.detail, ...findingsOf(result)];
  if (result.kind !== "made") out.push(result.blockedBy);
  if (result.kind === "unreached") out.push(result.unreachedUrl, result.transport);
  return out;
}

/** `fetch`, narrowed to what this tool uses, so a test can supply its own. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export interface RunOptions {
  /** Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Per-request timeout. Defaults to 10000. */
  readonly timeoutMs?: number;
  /**
   * The `Origin` header sent with every artifact request, so a host that gates
   * CORS on the request's origin answers the way it would answer a real caller.
   * Must not be the target's own origin, or the probe is same-origin and the CORS
   * result means nothing.
   */
  readonly probeOrigin?: string;
}

/** Where a network URL points, per §3.2. */
export interface Target {
  /** The URL as given. */
  readonly networkUrl: string;
  /** The site base: everything before the final path component, with a trailing slash. */
  readonly base: string;
  /** The final path component of the network URL. */
  readonly networkName: string;
  /** `agent-manifest.json` resolved against the base. */
  readonly manifestUrl: string;
}

/**
 * Why a check that needs an artifact could not be made.
 *
 * A union, so the unreached case CARRIES the failed request rather than being
 * handed a URL and an error that a caller could forget, mistype or borrow from
 * another artifact. There is one way to build an unreached result and it takes
 * the `NoAnswer` itself.
 */
export type Unavailable =
  | { readonly kind: "unreached"; readonly artifact: NoAnswer; readonly what: string }
  | { readonly kind: "unreadable"; readonly reason: string };
