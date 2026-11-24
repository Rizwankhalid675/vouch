// The report a publisher reads, and the exit code CI reads.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// The one rule this file exists to enforce: a check that was not made must be
// impossible to mistake for one that passed. So the label is the words NOT
// CHECKED, the declined checks are in their own section under their own heading,
// each says whose limitation blocked it, and the summary line counts them
// separately instead of folding them into a total. There is a test that reads
// the rendered text back and fails if the word PASS ever appears on a declined
// check's line.

import type { CheckResult, CheckStatus, Target } from "./types.ts";

export const VERSION = "0.1.0";
const PROFILE = "Open Agentic Web MVP Profile 0.3 (18 November 2026)";

const LABEL: Record<CheckStatus, string> = {
  pass: "PASS       ",
  fail: "FAIL       ",
  "not-demonstrated": "NOT CHECKED",
};

const BLOCKER_TEXT = {
  checker: "blocked by the checker: a command line cannot observe this",
  site: "blocked by the site: the artifacts this check needs were not readable",
  "checker-and-site": "blocked by the checker and by the site: both reasons apply, and they are set out below",
} as const;

/** 1 when any check failed, 0 otherwise. A not-demonstrated check never fails a build on its own. */
export function exitCodeFor(results: readonly CheckResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

function wrap(text: string, width: number, indent: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line === "") line = word;
    else if (`${line} ${word}`.length + indent.length <= width) line = `${line} ${word}`;
    else {
      out.push(indent + line);
      line = word;
    }
  }
  if (line !== "") out.push(indent + line);
  return out;
}

export function renderText(results: readonly CheckResult[], target: Target): string {
  const made = results.filter((r) => r.status !== "not-demonstrated");
  const notMade = results.filter((r) => r.status === "not-demonstrated");
  const failed = made.filter((r) => r.status === "fail");
  const lines: string[] = [];

  lines.push(`agentic-web-conformance ${VERSION}`);
  lines.push(PROFILE);
  lines.push("");
  lines.push(`network URL   ${target.networkUrl}`);
  lines.push(`site base     ${target.base}`);
  lines.push(`network name  ${target.networkName}`);
  lines.push("");
  lines.push(`${made.length} checks made, ${notMade.length} not checked.`);
  lines.push("");

  lines.push("CHECKED — what this tool looked at");
  lines.push("");
  for (const result of made) {
    lines.push(`  ${LABEL[result.status]}  ${result.section.padEnd(5)} ${result.title}`);
    lines.push(...wrap(result.detail, 100, "                       "));
    for (const finding of result.findings) {
      lines.push(...wrap(`- ${finding}`, 100, "                       "));
    }
    lines.push("");
  }

  lines.push("NOT CHECKED — what this tool declined, and why");
  lines.push("");
  lines.push("  These are not passes and they are not failures. Each one needs something a command line does not");
  lines.push("  have. Nothing below has been verified by this run.");
  lines.push("");
  for (const result of notMade) {
    lines.push(`  ${LABEL[result.status]}  ${result.section.padEnd(5)} ${result.title}`);
    if (result.blockedBy) {
      lines.push(`                       ${BLOCKER_TEXT[result.blockedBy]}`);
    }
    lines.push(...wrap(result.detail, 100, "                       "));
    for (const finding of result.findings) {
      lines.push(...wrap(`- ${finding}`, 100, "                       "));
    }
    lines.push("");
  }

  lines.push(
    `Result: ${failed.length} failed, ${made.length - failed.length} passed, ${notMade.length} NOT CHECKED ` +
      `— exit ${exitCodeFor(results)}`,
  );
  if (failed.length === 0) {
    lines.push("No check that this tool is able to make has failed. That is not the same as conformance:");
    lines.push(`${notMade.length} of the specification's checks were not made at all. See above for which.`);
  }
  return lines.join("\n");
}

export function renderJson(results: readonly CheckResult[], target: Target): string {
  return `${JSON.stringify(
    {
      tool: "agentic-web-conformance",
      version: VERSION,
      profile: PROFILE,
      target,
      summary: {
        checksMade: results.filter((r) => r.status !== "not-demonstrated").length,
        passed: results.filter((r) => r.status === "pass").length,
        failed: results.filter((r) => r.status === "fail").length,
        notChecked: results.filter((r) => r.status === "not-demonstrated").length,
        exitCode: exitCodeFor(results),
      },
      results,
    },
    null,
    2,
  )}\n`;
}
