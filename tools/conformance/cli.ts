#!/usr/bin/env node
// agentic-web-conformance — command line entry point.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// No build step: Node 22.18 and later run TypeScript directly by stripping the
// types, and nothing in this tool uses syntax that needs more than that. A
// publisher with Node installed can run it from a copy of this directory, or
// through `npx`, without installing anything.

import { DiscoveryError, deriveTarget } from "./src/discover.ts";
import { exitCodeFor, renderJson, renderText, VERSION } from "./src/report.ts";
import { runChecksOn } from "./src/index.ts";

const USAGE = `agentic-web-conformance ${VERSION}

Checks whether a published agent network conforms to the parts of the Open Agentic
Web MVP profile that can be checked from a shell, and says plainly which parts it
cannot check.

USAGE
  agentic-web-conformance <network-url> [options]

The URL is one published network, not a site root: its final path component is the
network name and the path before it is the site base (MVP profile §3.2). For
example, https://example.com/agents/my_network looks for
https://example.com/agents/agent-manifest.json and selects the entry named
my_network.

OPTIONS
  --json            Machine-readable output.
  --timeout <ms>    Per-request timeout. Default 10000.
  --origin <url>    The Origin header sent with each request, used to read the CORS
                    header off a real cross-origin response. Must not be the site's
                    own origin. Default https://agentic-web-conformance.invalid
  -h, --help        This text.
  -v, --version     Print the version.

EXIT CODES
  0  Every check this tool could make passed. NOT the same as conformance: see the
     NOT CHECKED section of the output for what was not verified.
  1  At least one check failed. A finding about the site.
  2  Bad usage, or a URL this tool cannot read as a network URL.
  3  The tool itself hit an error and did not finish. No verdict was reached.
  4  This tool never reached the host -- DNS, a refused connection, a proxy, a
     timeout, a typo in the hostname. No verdict about the site was reached, and
     nothing in the output is a finding about it. Non-zero because a run that
     learned nothing should not be green; distinct from 1 because a site cannot be
     at fault for a request that never arrived.
`;

interface Args {
  networkUrl?: string;
  json: boolean;
  timeoutMs?: number;
  probeOrigin?: string;
}

function parse(argv: readonly string[]): Args | { help: true } | { version: true } | { error: string } {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "-v" || arg === "--version") return { version: true };
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--timeout") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) return { error: "--timeout needs a positive number of milliseconds" };
      args.timeoutMs = value;
    } else if (arg === "--origin") {
      const value = argv[++i];
      if (!value) return { error: "--origin needs a URL" };
      args.probeOrigin = value;
    } else if (arg.startsWith("-")) {
      return { error: `unknown option ${arg}` };
    } else if (args.networkUrl === undefined) {
      args.networkUrl = arg;
    } else {
      return { error: `unexpected second URL ${arg}; this tool checks one network at a time` };
    }
  }
  if (args.networkUrl === undefined) return { error: "no network URL given" };
  return args;
}

async function main(): Promise<number> {
  const parsed = parse(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(USAGE);
    return 0;
  }
  if ("version" in parsed) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if ("error" in parsed) {
    process.stderr.write(`agentic-web-conformance: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  let target;
  try {
    target = deriveTarget(parsed.networkUrl!);
  } catch (err) {
    if (err instanceof DiscoveryError) {
      process.stderr.write(`agentic-web-conformance: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  if (parsed.probeOrigin !== undefined) {
    try {
      if (new URL(parsed.probeOrigin).origin === new URL(target.networkUrl).origin) {
        process.stderr.write(
          "agentic-web-conformance: --origin is the site's own origin, which would make the CORS probe " +
            "same-origin and its result meaningless. Give another origin, or leave it unset.\n",
        );
        return 2;
      }
    } catch {
      process.stderr.write("agentic-web-conformance: --origin is not a URL\n");
      return 2;
    }
  }

  const results = await runChecksOn(target, {
    timeoutMs: parsed.timeoutMs,
    probeOrigin: parsed.probeOrigin,
  });
  process.stdout.write(parsed.json ? renderJson(results, target) : `${renderText(results, target)}\n`);
  return exitCodeFor(results);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Exit 3, not 1: a tool that crashed reached no verdict, and a crash that
    // looks like a failed check is the same lie in the other direction.
    process.stderr.write(
      `agentic-web-conformance: the checker itself failed and reached no verdict.\n${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    process.exit(3);
  },
);
