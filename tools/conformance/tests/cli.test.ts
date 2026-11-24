// The command line, including the paths that only fire when something is wrong.
//
// WHY THESE EXIST
//
// The README publishes an exit-code table and a publisher is invited to put the
// tool in CI on the strength of it. Three of those codes had never been
// exercised, and one of them is **exit 3**: the code that says "this run produced
// no information at all". It is supposed to fire when everything else has already
// failed, which makes an untested version of it the least trustworthy line in the
// tool -- a branch whose whole job is to be right on the worst day, never once
// observed being right on any day.
//
// Exit 2 matters for a quieter reason. A mistyped URL is the single most likely
// first interaction anybody has with this tool, and the difference between "I
// cannot read that as a network URL" (2) and "your site is broken" (1) is the same
// distinction the rest of the tool is about, one layer out.
//
// These drive `cliMain` directly rather than spawning a process: the exit codes
// are what is under test, and a subprocess would test `process.exit` instead.

import { describe, expect, test } from "vitest";
import { cliMain, reportCrash, type CliIo } from "../src/cli.ts";
import type { CheckResult } from "../src/types.ts";
import { BASE, NETWORK_URL, conformingSite, serve } from "./fixture.ts";

/** Collects what the CLI wrote, and optionally stands in for the checker. */
function io(runChecks?: CliIo["runChecks"]): CliIo & { stdout: string; stderr: string } {
  const captured = {
    stdout: "",
    stderr: "",
    out(text: string) {
      captured.stdout += text;
    },
    err(text: string) {
      captured.stderr += text;
    },
    runChecks,
  };
  return captured;
}

/** A runner that answers from the in-memory fixture, so no real network is touched. */
const fixtureRunner =
  (files = conformingSite()): NonNullable<CliIo["runChecks"]> =>
  async (target, options) => {
    const { runChecksOn } = await import("../src/index.ts");
    return runChecksOn(target, { ...options, fetchImpl: serve(files).fetchImpl });
  };

describe("exit 2: the tool could not even start, which is not a verdict about anybody's site", () => {
  test("no URL at all", async () => {
    const out = io();
    expect(await cliMain([], out)).toBe(2);
    expect(out.stderr).toContain("no network URL given");
    expect(out.stderr).toContain("USAGE");
    expect(out.stdout).toBe("");
  });

  test("a string that is not a URL", async () => {
    const out = io();
    expect(await cliMain(["not a url"], out)).toBe(2);
    expect(out.stderr).toMatch(/not a URL/i);
  });

  test("a URL with no final path component, so there is no network name in it", async () => {
    const out = io();
    expect(await cliMain(["https://example.com/agents/"], out)).toBe(2);
    expect(out.stderr).toMatch(/network name/i);
    // It says what a URL should look like instead, rather than only that this one is wrong.
    expect(out.stderr).toMatch(/my_network|final path component/);
  });

  test("a scheme that is not http(s)", async () => {
    const out = io();
    expect(await cliMain(["file:///tmp/agents/demo"], out)).toBe(2);
    expect(out.stderr).toMatch(/http/i);
  });

  test("an unknown option, and a second URL", async () => {
    const a = io();
    expect(await cliMain(["--wat", "https://example.com/agents/x"], a)).toBe(2);
    expect(a.stderr).toContain("--wat");

    const b = io();
    expect(await cliMain(["https://a.example/agents/x", "https://b.example/agents/y"], b)).toBe(2);
    expect(b.stderr).toMatch(/one network at a time/);
  });

  test("--timeout without a positive number, and --origin without a URL", async () => {
    for (const argv of [
      ["https://example.com/agents/x", "--timeout"],
      ["https://example.com/agents/x", "--timeout", "0"],
      ["https://example.com/agents/x", "--timeout", "soon"],
      ["https://example.com/agents/x", "--origin"],
      ["https://example.com/agents/x", "--origin", "not a url"],
    ]) {
      const out = io();
      expect(await cliMain(argv, out), argv.join(" ")).toBe(2);
    }
  });

  test("--origin set to the site's own origin is refused, because it would make the CORS result meaningless", async () => {
    // A same-origin probe reads a pass off a host that would refuse every real
    // caller. Accepting it would hand someone a green CORS check that means
    // nothing, which is worse than refusing the flag.
    const out = io(fixtureRunner());
    expect(await cliMain([NETWORK_URL, "--origin", "https://fixture.example"], out)).toBe(2);
    expect(out.stderr).toMatch(/same-origin/);
    expect(out.stdout).toBe("");

    // A different origin is accepted and the run proceeds.
    const fine = io(fixtureRunner());
    expect(await cliMain([NETWORK_URL, "--origin", "https://somewhere-else.example"], fine)).toBe(0);
  });
});

describe("exit 3: the checker itself broke and reached no verdict", () => {
  test("a crash in the checker exits 3, never 1", async () => {
    // 1 would say "your site failed a check" about a run that checked nothing.
    const out = io(() => Promise.reject(new Error("boom in the checker")));
    let code: number | undefined;
    try {
      await cliMain([NETWORK_URL], out);
      throw new Error("cliMain should have rejected");
    } catch (err) {
      code = reportCrash(err, out);
    }
    expect(code).toBe(3);
    expect(out.stderr).toContain("boom in the checker");
  });

  test("the crash message says no verdict was reached, and that it is the checker's fault", async () => {
    const out = io();
    expect(reportCrash(new Error("kaboom"), out)).toBe(3);
    expect(out.stderr).toMatch(/reached no verdict/i);
    expect(out.stderr).toMatch(/bug in the checker, not a finding about the target/i);
    // It must not read as a conformance result of any kind.
    expect(out.stderr).not.toMatch(/\bFAIL\b/);
    expect(out.stderr).not.toMatch(/\bPASS\b/);
  });

  test("a thrown non-Error is still exit 3 and still says so", async () => {
    const out = io();
    expect(reportCrash("a string, because anything can be thrown", out)).toBe(3);
    expect(out.stderr).toContain("a string, because anything can be thrown");
  });
});

describe("exit 0, 1 and 4 come straight from the checks", () => {
  test("a conforming fixture exits 0 and prints the report", async () => {
    const out = io(fixtureRunner());
    expect(await cliMain([NETWORK_URL], out)).toBe(0);
    expect(out.stdout).toContain("NOT CHECKED");
    expect(out.stdout).toContain(NETWORK_URL);
  });

  test("a failing site exits 1", async () => {
    const files = conformingSite();
    delete files[`${BASE}links.json`];
    const out = io(fixtureRunner(files));
    expect(await cliMain([NETWORK_URL], out)).toBe(1);
  });

  test("a site that was never reached exits 4, and the output does not blame it", async () => {
    const files = conformingSite();
    for (const url of Object.keys(files)) files[url] = { throws: "ECONNREFUSED" };
    const out = io(fixtureRunner(files));
    expect(await cliMain([NETWORK_URL], out)).toBe(4);
    expect(out.stdout).toMatch(/reached no verdict about the site/i);
    expect(out.stdout).not.toMatch(/\bFAIL\b/);
  });

  test("--json is machine-readable and carries the exit code and the never-reached count", async () => {
    const out = io(fixtureRunner());
    expect(await cliMain([NETWORK_URL, "--json"], out)).toBe(0);
    const parsed = JSON.parse(out.stdout) as {
      summary: { checksMade: number; failed: number; notChecked: number; neverReached: number; exitCode: number };
      results: CheckResult[];
    };
    expect(parsed.summary.exitCode).toBe(0);
    expect(parsed.summary.failed).toBe(0);
    expect(parsed.summary.neverReached).toBe(0);
    expect(parsed.summary.notChecked).toBeGreaterThan(0);
    expect(parsed.results.length).toBe(parsed.summary.checksMade + parsed.summary.notChecked);
  });
});

describe("--help and --version", () => {
  test("both exit 0, write to stdout, and the help text documents every exit code", async () => {
    const help = io();
    expect(await cliMain(["--help"], help)).toBe(0);
    expect(help.stderr).toBe("");
    for (const code of ["0", "1", "2", "3", "4"]) {
      expect(help.stdout, `exit ${code}`).toMatch(new RegExp(`^\\s{2}${code}\\s`, "m"));
    }
    // ...and that the URL is one network, which is the thing people get wrong.
    expect(help.stdout).toMatch(/final path component is the\s+network name/);

    const version = io();
    expect(await cliMain(["-v"], version)).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
