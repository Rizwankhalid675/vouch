// Can this environment bind a loopback port, and what should the CORS tests do
// about it?
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// THE PROBLEM THIS SOLVES, AND THE ONE IT MUST NOT CREATE
//
// The CORS tests assert on a real HTTP response from a real `node:http` server,
// because a fabricated Response tests the author's idea of CORS rather than
// CORS. That is the right design and it is not negotiable here.
//
// But some environments refuse `listen()` outright — a sandbox with local port
// binding switched off answers `EPERM` — and in those the tests cannot run at
// all. The first version of this file failed hard, which was wrong for a reason
// worth writing down: **a suite that is expected to be red is how a genuine
// failure gets ignored.** A stranger running `npm test` on this repository reads
// "5 failed" and stops; they do not read the carefully worded error message.
//
// So: skip, and make the skip impossible to misread.
//
//  - Vitest reports skipped tests in its own counts, so a skip can never be read
//    as coverage obtained. "5 skipped" is not "5 passed".
//  - A notice goes to stderr naming the reason and the command that runs them for
//    real. Never a silent skip.
//  - `npm run test:cors` sets CONFORMANCE_CORS_REQUIRED=1, and then there is no
//    skip: the tests run and fail with the bind error, which is what you want
//    from a command whose entire purpose is to run them for real.
//  - And never, under any condition, a pass. There is no branch here that turns
//    an unrun test green.

import { createServer } from "node:http";

export interface BindProbe {
  readonly ok: boolean;
  /** Why not, when not. Empty when ok. */
  readonly reason: string;
}

/** Binds and immediately closes, or explains why it could not. Injectable so the failure path is testable. */
export type Listener = () => Promise<void>;

const realListen: Listener = () =>
  new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(`${err.code ?? "error"}: ${err.message}`));
    });
    server.listen(0, "127.0.0.1", () => server.close(() => resolve()));
  });

export async function probeLoopbackBind(listen: Listener = realListen): Promise<BindProbe> {
  try {
    await listen();
    return { ok: true, reason: "" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** True only for an explicit opt-in, so the default suite is never the demanding one. */
export function corsRequired(env: Record<string, string | undefined>): boolean {
  const value = env["CONFORMANCE_CORS_REQUIRED"];
  return value === "1" || value === "true";
}

export interface Gate {
  /** Skip the real-server tests. Never implies they passed. */
  readonly skip: boolean;
  /** A line for stderr. Null only when everything is fine and there is nothing to say. */
  readonly notice: string | null;
}

const RUN_FOR_REAL = "npm run test:cors";

export function corsGate(probe: BindProbe, required: boolean): Gate {
  if (probe.ok) return { skip: false, notice: null };
  if (required) {
    return {
      skip: false,
      notice:
        `[agentic-web-conformance] CORS tests are REQUIRED (CONFORMANCE_CORS_REQUIRED) and this ` +
        `environment refuses to bind a loopback port, so they are about to FAIL rather than skip. ` +
        `Reason: ${probe.reason}`,
    };
  }
  return {
    skip: true,
    notice:
      `\n[agentic-web-conformance] NOT RUN: the 5 CORS tests were SKIPPED, not passed.\n` +
      `  This environment refuses to bind a loopback port (${probe.reason}), and those tests\n` +
      `  assert on a real HTTP response from a real server by design -- they are the only place\n` +
      `  a CORS header is read off anything other than an object we built ourselves.\n` +
      `  Nothing about CORS has been verified by this run.\n` +
      `  Run them for real:  ${RUN_FOR_REAL}\n` +
      `  (In Claude Code's sandbox: sandbox.network.allowLocalBinding: true, no restart needed.)\n`,
  };
}
