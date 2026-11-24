// The CORS check, against a real HTTP response.
//
// WHY THIS ONE TEST IS DIFFERENT
//
// Every other check in this tool is tested through an injected `fetchImpl` that
// returns a Response this file constructed. That is fine for JSON shape: the
// thing under test there is our parsing.
//
// It is NOT fine here. CORS is "the check most likely to pass locally and fail
// deployed", and the reason is that a config file is not a header. A fabricated
// `new Response(body, { headers: { "access-control-allow-origin": "*" } })`
// tests our idea of CORS -- it asserts that the checker can read back a header
// we just typed. The thing that actually goes wrong in the field is a server
// that was configured for one host's header format and deployed to another's,
// where the file is present, the config looks right, and the header never
// arrives.
//
// So this file starts a real `node:http` server on loopback, twice: once
// answering with `Access-Control-Allow-Origin` and once answering without it on
// one artifact. The checker runs against the real origin with the real
// `globalThis.fetch`, and the assertions are on what the real responses produced.
// Zero dependencies -- `node:http` ships with the runtime the tool already needs.
//
// IT MUST NEVER PASS WITHOUT RUNNING. Where `listen()` is refused — a sandbox
// with local port binding off answers EPERM — these five are SKIPPED, loudly,
// with the reason and the command that runs them for real written to stderr.
// Vitest counts skipped tests separately, so "5 skipped" can never be read as
// coverage obtained, and `npm run test:cors` removes the skip so they run and
// fail instead. The gate itself is tested below, outside the skippable block, so
// the skip logic cannot quietly become a pass. loopback.ts says why it is a skip
// rather than a hard failure: a suite that is expected to be red is how a real
// failure gets ignored.

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { runChecks } from "../src/index.ts";
import type { CheckResult } from "../src/types.ts";
import { conformingSite } from "./fixture.ts";
import { corsGate, corsRequired, probeLoopbackBind, type BindProbe } from "./loopback.ts";

/* ================================================================== */
/* The gate. These always run, whatever the environment can do.        */
/* ================================================================== */

describe("the loopback gate: a skip that can never read as a pass", () => {
  const bindable: BindProbe = { ok: true, reason: "" };
  const refused: BindProbe = { ok: false, reason: "EPERM: operation not permitted 127.0.0.1" };

  test("when a port can be bound, nothing is skipped and there is nothing to announce", () => {
    expect(corsGate(bindable, false)).toEqual({ skip: false, notice: null });
    expect(corsGate(bindable, true)).toEqual({ skip: false, notice: null });
  });

  test("when a port cannot be bound, the tests are skipped and the notice says they did not run", () => {
    const gate = corsGate(refused, false);
    expect(gate.skip).toBe(true);
    expect(gate.notice).toBeTruthy();
    expect(gate.notice!).toContain("NOT RUN");
    expect(gate.notice!).toContain("SKIPPED, not passed");
    expect(gate.notice!).toContain("EPERM");
    expect(gate.notice!).toContain("npm run test:cors");
    expect(gate.notice!).toMatch(/Nothing about CORS has been verified/);
  });

  test("when they are REQUIRED, a refused port does not skip: they run and fail", () => {
    // `npm run test:cors` exists to run them for real. A command that skipped
    // when it could not do the one thing it is for would be the fail-open default
    // in a new costume.
    const gate = corsGate(refused, true);
    expect(gate.skip).toBe(false);
    expect(gate.notice!).toContain("REQUIRED");
    expect(gate.notice!).toMatch(/FAIL rather than skip/);
  });

  test("REQUIRED is an explicit opt-in, so the default suite is never the demanding one", () => {
    expect(corsRequired({})).toBe(false);
    expect(corsRequired({ CONFORMANCE_CORS_REQUIRED: "" })).toBe(false);
    expect(corsRequired({ CONFORMANCE_CORS_REQUIRED: "0" })).toBe(false);
    expect(corsRequired({ CONFORMANCE_CORS_REQUIRED: "1" })).toBe(true);
    expect(corsRequired({ CONFORMANCE_CORS_REQUIRED: "true" })).toBe(true);
  });

  test("the probe reports a refused bind as refused, with the reason, and never throws", async () => {
    const thrown = await probeLoopbackBind(() => Promise.reject(new Error("EPERM: operation not permitted")));
    expect(thrown.ok).toBe(false);
    expect(thrown.reason).toContain("EPERM");

    const fine = await probeLoopbackBind(() => Promise.resolve());
    expect(fine).toEqual({ ok: true, reason: "" });
  });
});

/* ================================================================== */
/* The real thing.                                                     */
/* ================================================================== */

const probe = await probeLoopbackBind();
const gate = corsGate(probe, corsRequired(process.env));
if (gate.notice) process.stderr.write(`${gate.notice}\n`);

/** The fixture's three artifacts, keyed by the path a real server would serve them at. */
function artifactBodies(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, file] of Object.entries(conformingSite())) {
    out[new URL(url).pathname] = JSON.stringify(file.body);
  }
  return out;
}

interface Running {
  readonly origin: string;
  readonly seenOrigins: Map<string, string | undefined>;
  close(): Promise<void>;
}

/**
 * Starts a real server on 127.0.0.1 and returns its real origin.
 *
 * `corsFor` decides, per path, what `Access-Control-Allow-Origin` to answer with;
 * returning undefined omits the header entirely, which is what a misconfigured
 * host actually does.
 */
async function start(corsFor: (path: string, origin: string | undefined) => string | undefined): Promise<Running> {
  const bodies = artifactBodies();
  const seenOrigins = new Map<string, string | undefined>();
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const origin = req.headers.origin;
    seenOrigins.set(path, origin);
    const body = bodies[path];
    if (body === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const allow = corsFor(path, origin);
    res.writeHead(200, {
      "content-type": "application/json",
      ...(allow === undefined ? {} : { "access-control-allow-origin": allow, vary: "Origin" }),
    });
    res.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `could not bind a loopback port for the CORS test (${err.code ?? err.message}). ` +
            "This test asserts on a real HTTP response by design and must not be skipped: " +
            "if the environment forbids listen(), run it where local port binding is allowed.",
        ),
      );
    });
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server has no address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    seenOrigins,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let running: Running | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const corsCheck = (results: readonly CheckResult[]): CheckResult => {
  const found = results.find((r) => r.check === "cors-hosting");
  if (!found) throw new Error("no cors-hosting check in the results");
  return found;
};

describe.skipIf(gate.skip)("§3.3/§3.4 CORS, read off a real response", () => {
  test("a server that really sends the header passes, and the probe really sent an Origin", async () => {
    running = await start(() => "*");
    const results = await runChecks(`${running.origin}/agents/demo`);
    const check = corsCheck(results);
    expect(check.status, check.findings.join("\n")).toBe("pass");

    // The header is only half of it. A server may gate CORS on the request's
    // Origin, so a probe that sends none gets a pass it did not earn. Read what
    // the server actually received.
    const origins = [...running.seenOrigins.entries()];
    expect(origins.length).toBeGreaterThanOrEqual(3);
    for (const [path, origin] of origins) {
      expect(origin, `no Origin header on the request for ${path}`).toBeTruthy();
      expect(origin).not.toContain("127.0.0.1");
    }
  });

  test("a server that omits the header on ONE artifact fails, and the finding names that artifact", async () => {
    running = await start((path) => (path.endsWith("/links.json") ? undefined : "*"));
    const results = await runChecks(`${running.origin}/agents/demo`);
    const check = corsCheck(results);
    expect(check.status).toBe("fail");
    const findings = check.findings.join("\n");
    expect(findings).toContain("/agents/links.json");
    expect(findings).not.toContain("/agents/agent-manifest.json");
  });

  test("a header echoing some other origin fails, and the finding gives the value returned", async () => {
    // The commonest real misconfiguration after "no header at all": a host
    // configured to allow one known caller. It is not a conformance pass for
    // anyone else, and a checker that tested only for the header's presence
    // would call it one.
    running = await start(() => "https://some-other-caller.example");
    const results = await runChecks(`${running.origin}/agents/demo`);
    const check = corsCheck(results);
    expect(check.status).toBe("fail");
    expect(check.findings.join("\n")).toContain("https://some-other-caller.example");
  });

  test("a header echoing the probe's own Origin passes, because that is what the header is for", async () => {
    running = await start((_path, origin) => origin);
    const results = await runChecks(`${running.origin}/agents/demo`);
    expect(corsCheck(results).status).toBe("pass");
  });

  test("nothing else in the run depends on the fake: the real server satisfies the shape checks too", async () => {
    // If the fixture served through `fetchImpl` and the fixture served over real
    // HTTP ever disagree, this is the test that notices.
    running = await start(() => "*");
    const results = await runChecks(`${running.origin}/agents/demo`);
    const failed = results.filter((r) => r.status === "fail");
    expect(failed.map((r) => `${r.check}: ${r.detail}`)).toEqual([]);
    expect(results.find((r) => r.check === "manifest-reachable")!.findings.join("")).toContain(
      `${running.origin}/agents/agent-manifest.json`,
    );
  });
});
