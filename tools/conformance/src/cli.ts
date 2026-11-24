// agentic-web-conformance — the command line, as a function.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// This is the whole CLI except the two lines that call it. `../cli.ts` is the bin
// and does nothing but hand `process.argv` and the real streams to `cliMain`,
// because the exit codes documented in the README are part of the contract and an
// entry point that runs on import cannot be tested.
//
// EXIT 3 is the reason this split exists. It is the code that says "this run
// produced no information at all", it is supposed to fire when everything else
// has already failed, and it was the least trustworthy line in the tool: an
// untested branch whose whole job is to be correct on the worst day. It has tests
// now, and so do the exit-2 paths.

import { DiscoveryError, deriveTarget } from "./discover.ts";
import { exitCodeFor, renderJson, renderText, VERSION } from "./report.ts";
import { runChecksOn } from "./index.ts";
import type { CheckResult, RunOptions, Target } from "./types.ts";

/** The streams and the runner, so a test can supply its own. */
export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  /** Defaults to the real `runChecksOn`. A test uses this to force the crash path. */
  runChecks?: (target: Target, options: RunOptions) => Promise<CheckResult[]>;
}

export const realIo: CliIo = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

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

export async function cliMain(argv: readonly string[], io: CliIo = realIo): Promise<number> {
  const parsed = parse(argv);
  if ("help" in parsed) {
    io.out(USAGE);
    return 0;
  }
  if ("version" in parsed) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if ("error" in parsed) {
    io.err(`agentic-web-conformance: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  let target: Target;
  try {
    target = deriveTarget(parsed.networkUrl!);
  } catch (err) {
    if (err instanceof DiscoveryError) {
      io.err(`agentic-web-conformance: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  if (parsed.probeOrigin !== undefined) {
    try {
      if (new URL(parsed.probeOrigin).origin === new URL(target.networkUrl).origin) {
        io.err(
          "agentic-web-conformance: --origin is the site's own origin, which would make the CORS probe " +
            "same-origin and its result meaningless. Give another origin, or leave it unset.\n",
        );
        return 2;
      }
    } catch {
      io.err("agentic-web-conformance: --origin is not a URL\n");
      return 2;
    }
  }

  const results = await (io.runChecks ?? runChecksOn)(target, {
    timeoutMs: parsed.timeoutMs,
    probeOrigin: parsed.probeOrigin,
  });
  io.out(parsed.json ? renderJson(results, target) : `${renderText(results, target)}\n`);
  return exitCodeFor(results);
}

/**
 * Exit 3, not 1: a tool that crashed reached NO verdict, and a crash that looks
 * like a failed check is the same lie as a check that passes without running.
 *
 * It says so in words as well as in the code, because a reader sees the words.
 */
export function reportCrash(err: unknown, io: CliIo = realIo): number {
  io.err(
    `agentic-web-conformance: the checker itself failed and reached no verdict. Nothing was concluded ` +
      `about the site -- this is a bug in the checker, not a finding about the target.\n${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
  );
  return 3;
}
