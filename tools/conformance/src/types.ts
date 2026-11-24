// agentic-web-conformance — shared types.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
// See the LICENSE and NOTICE files alongside this directory.

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

export interface CheckResult {
  /** Stable id, safe to grep in CI output. */
  readonly check: string;
  /** One short line a publisher reads. */
  readonly title: string;
  readonly status: CheckStatus;
  /** The section of the MVP profile this check is taken from, e.g. "§3.3". */
  readonly section: string;
  /** Why this status, in one sentence. On a `not-demonstrated`, what would be needed instead. */
  readonly detail: string;
  /**
   * Evidence. On a failure: the offending values, each with the JSON path or URL
   * it was found at, so the output is actionable without re-running anything. On
   * a pass: what was actually observed, so a pass is also checkable.
   *
   * Never a credential. A report gets pasted into issues and CI logs.
   */
  readonly findings: readonly string[];
  /** Set exactly when `status` is `not-demonstrated`. */
  readonly blockedBy?: Blocker;
  /**
   * True when the reason this check was not made is that the request never got
   * an answer at all -- a DNS failure, a refused connection, a blocked proxy, a
   * timeout.
   *
   * This exists because a site cannot be at fault for a request that never
   * arrived, and because someone's CI needs to tell "your site failed a check"
   * from "nothing was contacted". It drives exit code 4.
   */
  readonly unreached?: boolean;
  /**
   * The artifact URL that got no answer, when this check was blocked by one.
   *
   * The report's loudest sentence counts these. It used to count `CheckResult`s
   * and call them artifacts, which made the headline number four times the truth
   * with the wrong unit -- and both readers of that output repeated the wrong
   * number. A count of requests that got no answer is a fact; a count of results
   * wearing the word "artifacts" is not.
   */
  readonly unreachedUrl?: string;
}

/** Why a check that needs an artifact could not be made, and whose limitation that is. */
export interface Unavailable {
  readonly reason: string;
  readonly blockedBy: Blocker;
  /** The artifact was never answered for, as opposed to answered badly. */
  readonly unreached: boolean;
  /** Which artifact, when one got no answer. Named rather than generalised to "the host". */
  readonly url?: string;
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
