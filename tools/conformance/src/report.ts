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

import { findingsOf, isUnreached } from "./types.ts";
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

/**
 * 0 all clear, 1 something failed, 4 the run was incomplete.
 *
 * EXIT 4 IS "INCOMPLETE", NOT "NOTHING WAS CONTACTED". It fires when **any one**
 * artifact got no answer, which is usually not all of them: an unreachable link
 * map leaves twelve checks passing and still exits 4. The banner was corrected to
 * say that and this comment was not, so it defined the code as a sentence the
 * output had stopped making -- which matters, because a comment and a README are
 * what a CI owner reads to decide what the number means.
 *
 * Why it is not 0: a run that could not make some of its checks is not a clean
 * bill of health, and a green CI line would say it was. Why it is not 1: a site
 * cannot be at fault for a request that never arrived, and 1 means a finding
 * about the site.
 *
 * A real failure outranks it. A finding is a finding even when another artifact
 * never answered, so a mixed run exits 1 and the banner gives both halves.
 */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_UNREACHED = 4;

export function exitCodeFor(results: readonly CheckResult[]): number {
  if (results.some((r) => r.status === "fail")) return EXIT_FAILED;
  if (results.some(isUnreached)) return EXIT_UNREACHED;
  return EXIT_OK;
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
    if (isUnreached(result)) {
      lines.push(
        "                       blocked by the checker: this run never reached the host, so nothing here is",
      );
      lines.push("                       a statement about the site");
    } else if (result.kind === "declined") {
      lines.push(`                       ${BLOCKER_TEXT[result.blockedBy]}`);
    }
    lines.push(...wrap(result.detail, 100, "                       "));
    for (const finding of findingsOf(result)) {
      lines.push(...wrap(`- ${finding}`, 100, "                       "));
    }
    lines.push("");
  }

  lines.push(
    `Result: ${failed.length} failed, ${made.length - failed.length} passed, ${notMade.length} NOT CHECKED ` +
      `— exit ${exitCodeFor(results)}`,
  );
  // TWO NUMBERS, TWO UNITS. This counted `CheckResult`s and called them artifacts:
  // thirteen of them, for a site that publishes three. Both readers of that output
  // repeated the wrong figure, which is worth knowing about this report -- it is
  // persuasive, so its errors travel. Requests that got no answer is a fact;
  // results wearing the word "artifacts" is not.
  const unreached = results.filter(isUnreached);
  // Every unreached result names its artifact -- the type requires it -- so this
  // is a count of requests that got no answer, not a count of our own output. ONE
  // LINE PER ARTIFACT, not per blocked check: six checks blocked by one refused
  // request is one refused request, and printing it six times would restate the
  // unit error the count was fixed for.
  const unreachedArtifacts = [...new Map(unreached.map((r) => [r.unreachedUrl, r.transport])).entries()];
  const checkWord = unreached.length === 1 ? "check" : "checks";
  if (unreached.length > 0 && failed.length > 0) {
    // THE MIXED STATE, which is real and which a reader needs both halves of. The
    // old branch printed "Nothing above is a finding about this site's conformance"
    // underneath a genuine FAIL -- a real site failure disclaimed as the checker's
    // fault, in the line a reader skims to.
    lines.push("");
    lines.push(
      `MIXED RESULT. ${unreachedArtifacts.length} of this site's artifacts never answered, so ` +
        `${unreached.length} ${checkWord} could not be made.`,
    );
    lines.push(
      failed.length === 1
        ? "But 1 check that WAS made failed, and that finding above stands."
        : `But ${failed.length} checks that WERE made failed, and those findings above stand.`,
    );
    lines.push("Fix those, and check the network for the artifacts that got no answer.");
    for (const [url, transport] of unreachedArtifacts) lines.push(`  no answer: ${url} — ${transport}`);
  } else if (unreached.length > 0) {
    // NOT "no verdict about the site at all", and not "nothing above is a finding
    // about this site's conformance". Both were the round-3 pattern one step
    // further on: a true statement about the wholly-unreachable case, generalised
    // into a sentence printed when twelve checks had passed. "Incomplete" is true
    // in every sub-case, which is why it is the sentence.
    lines.push("");
    lines.push(
      `THIS RUN IS INCOMPLETE. ${unreachedArtifacts.length} of this site's artifacts never answered, so ` +
        `${unreached.length} ${checkWord} could not be made.`,
    );
    lines.push("Nothing that was not checked has been verified, and no passing check above covers it.");
    lines.push("Check the URL, then whether this machine can reach that host.");
    for (const [url, transport] of unreachedArtifacts) lines.push(`  no answer: ${url} — ${transport}`);
  } else if (failed.length === 0) {
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
        neverReached: results.filter(isUnreached).length,
        artifactsNeverAnswered: [...new Set(results.filter(isUnreached).map((r) => r.unreachedUrl))].length,
        exitCode: exitCodeFor(results),
      },
      results,
    },
    null,
    2,
  )}\n`;
}
