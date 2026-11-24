// The structural invariant, asserted rather than assumed.
//
// WHY THIS FILE EXISTS
//
// The same defect came back four times: a statement about a site, derived from a
// document the tool never read. Each round found the reader and guarded it, and
// the next round found another reader, because nothing prevented one being
// written. Round four stopped guarding and changed the types instead:
//
//   - `fetch.ts`: a request that got no answer is a `NoAnswer`, which has no
//     `status`, no headers and no body and no fields for them. `fetched.json`
//     does not compile until the caller has narrowed on `outcome`.
//   - `types.ts`: a check not made because of that is an `UnreachedCheck`, which
//     has no `findings` field at all, whose `blockedBy` is the literal "checker",
//     and whose `unreachedUrl` is required.
//
// Eight ways of writing the next instance were tried against the compiler and all
// eight were refused. But a type system cannot stop someone switching it off, and
// `as unknown as` or `@ts-expect-error` would do exactly that. So:
//
//  1. The source is checked for those escapes. If one appears, this fails, and
//     whoever added it has to say why in a diff someone will read.
//  2. The invariant is asserted at RUNTIME too, over a real unreachable run,
//     because `--json` output is parsed by things that have no types at all.
//
// This is the same move the project made on its safety gate: after three rounds
// of patching a deny-list, invert it, and then assert the inversion holds.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { runChecks } from "../src/index.ts";
import { exitCodeFor } from "../src/report.ts";
import { isUnreached } from "../src/types.ts";
import { conformingSite, serve, BASE, NETWORK_URL } from "./fixture.ts";

const toolRoot = resolve(import.meta.dirname, "..");

/** Every TypeScript file the published tool ships, excluding its tests. */
function sourceFiles(): { path: string; text: string }[] {
  const files = [{ path: "cli.ts", text: readFileSync(resolve(toolRoot, "cli.ts"), "utf8") }];
  for (const name of readdirSync(resolve(toolRoot, "src"))) {
    if (name.endsWith(".ts")) {
      files.push({ path: `src/${name}`, text: readFileSync(resolve(toolRoot, "src", name), "utf8") });
    }
  }
  return files;
}

describe("the invariant cannot be switched off quietly", () => {
  test("the tool's source contains no escape from the type system", () => {
    // `as unknown as X`, `as never` and the suppression comments are the only ways
    // to write past the types that make an unreached result unable to carry
    // document-derived content. An ordinary `as { ... }` on a parsed JSON value is
    // not on this list: narrowing `unknown` is what the tool does for a living.
    const escapes: [RegExp, string][] = [
      [/\bas\s+unknown\s+as\b/, "`as unknown as` defeats the narrowing that makes an unread body unreadable"],
      [/\bas\s+never\b/, "`as never` does the same"],
      [/@ts-ignore|@ts-expect-error|@ts-nocheck/, "a suppression comment switches the compiler off"],
    ];
    const found: string[] = [];
    for (const file of sourceFiles()) {
      file.text.split("\n").forEach((line, i) => {
        for (const [pattern, why] of escapes) {
          if (pattern.test(line)) found.push(`${file.path}:${i + 1}: ${why}\n    ${line.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
    // ...and this scan is live: it sees a planted one.
    expect(escapes.some(([p]) => p.test("const x = network as unknown as { json: unknown };"))).toBe(true);
    expect(escapes.some(([p]) => p.test("// @ts-expect-error"))).toBe(true);
    // ...and does not fire on the ordinary narrowing the tool is full of.
    expect(escapes.some(([p]) => p.test('const doc = gate.doc as { tools?: unknown };'))).toBe(false);
  });

  test("the source files that enforce it say so, so a later reader does not undo it by accident", () => {
    const types = readFileSync(resolve(toolRoot, "src/types.ts"), "utf8");
    const fetch = readFileSync(resolve(toolRoot, "src/fetch.ts"), "utf8");
    expect(types).toMatch(/no `findings` field/);
    expect(fetch).toMatch(/COMPILE\s*\n?\s*\*?\s*ERROR|compile error/i);
  });
});

describe("the invariant holds at runtime, where --json consumers live", () => {
  /** A run in which no request got an answer. */
  async function unreachableRun() {
    const files = conformingSite();
    for (const url of Object.keys(files)) files[url] = { throws: "ECONNREFUSED 10.0.0.1:443" };
    return (await runChecks(NETWORK_URL, { fetchImpl: serve(files).fetchImpl })).slice();
  }

  test("no unreached result carries a findings array at all — not even an empty one", async () => {
    const results = await unreachableRun();
    const unreached = results.filter(isUnreached);
    expect(unreached.length).toBeGreaterThan(0);
    for (const result of unreached) {
      expect(Object.hasOwn(result, "findings"), `${result.check} carries a findings array`).toBe(false);
    }
    // A made or declined result still has one: the field was removed from one
    // variant, not from the type.
    for (const result of results.filter((r) => !isUnreached(r))) {
      expect(Object.hasOwn(result, "findings"), result.check).toBe(true);
    }
  });

  test("no unreached result names the site as a reason, and every one names its artifact", async () => {
    const results = await unreachableRun();
    for (const result of results.filter(isUnreached)) {
      expect(result.blockedBy, result.check).toBe("checker");
      expect(result.blockedBy.includes("site"), result.check).toBe(false);
      // Required by the type, asserted here because the headline count in the
      // report is a count of these: without it the number is a coincidence.
      expect(result.unreachedUrl, result.check).toMatch(/^https?:\/\//);
      expect(result.transport, result.check).not.toBe("");
    }
  });

  test("a mixed run keeps both halves straight: the finding stands, the unreached artifact is still unreached", async () => {
    const files = conformingSite();
    files[`${BASE}links.json`] = { throws: "ECONNREFUSED" };
    const net = files[`${BASE}demo.network.json`]!.body as { tools: { name: string }[] };
    net.tools[1]!.name = "an agent with a space";
    const results = await runChecks(NETWORK_URL, { fetchImpl: serve(files).fetchImpl });

    expect(exitCodeFor(results)).toBe(1);
    const failed = results.filter((r) => r.status === "fail");
    expect(failed.map((r) => r.check)).toEqual(["agent-definitions"]);
    // Every failure is a `made` result, so it has evidence; no `unreached` one does.
    for (const result of failed) expect(result.kind).toBe("made");
    expect(results.filter(isUnreached).length).toBeGreaterThan(0);
  });
});
