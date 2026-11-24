// §2.2's portable-data rules, and §4's credential rule.
//
// Copyright 2026 Rizwankhalid675. Licensed under the Apache License, Version 2.0.
//
// ANCHORING: READ THIS BEFORE CHANGING A REGEX HERE
//
// §2 is explicit about what a published network may not depend on: "The published
// form MUST preserve the Neuro SAN data model and MUST NOT depend on local
// includes, environment substitutions, or publisher-only file paths that the
// Neuro SAN HOCON format affords on server systems."
//
// A publisher-only path does not have to be the whole value. It turns up inside a
// sentence, in an agent's instructions, in a note beside a URL. An earlier
// version of this project's own version of this check anchored every rule to `^`
// and would have passed, with a green tick:
//
//     "Overrides live in ./local-overrides.json when present."
//
// So no rule here is anchored to the start of the string. Where a rule needs a
// boundary to stay useful, the boundary is "start of string OR a character that
// is not alphanumeric" — which still matches in the middle of a sentence, and
// still refuses to read `etc./and` or `and/or` as a filesystem path. That is a
// different thing from `^`, and the difference has a test.
//
// EXEMPTION: an `http://` or `https://` string is an address, not a local path,
// so the path-shaped rules do not apply to it. The substitution, templating and
// environment rules still do — a URL carrying `${MCP_TOKEN}` is exactly as
// unportable as a file path carrying it, and that also has a test.

export interface Finding {
  readonly path: string;
  readonly what: string;
  readonly excerpt: string;
}

/** Every string value and every key in a JSON document, with the path it sits at. */
export function walk(
  value: unknown,
  path = "",
  out: { path: string; key?: string; str?: string }[] = [],
): { path: string; key?: string; str?: string }[] {
  if (typeof value === "string") {
    out.push({ path: path || "$", str: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const child = path === "" ? key : `${path}.${key}`;
      out.push({ path: child, key });
      walk(item, child, out);
    }
  }
  return out;
}

/**
 * Where the http(s) URLs are in a string, as [start, end) offsets.
 *
 * The terminator set is the characters that cannot appear unescaped in a URL but
 * routinely end one in prose: whitespace, quotes, angle brackets, and the closers
 * and separators a sentence puts after an address. Trailing sentence punctuation
 * is trimmed off the span -- which matters, because leaving it in would widen the
 * span over the character that begins whatever comes next.
 */
function urlSpans(str: string): [number, number][] {
  const spans: [number, number][] = [];
  const finder = /https?:\/\/[^\s"'<>)\]}`,]+/gi;
  for (let m = finder.exec(str); m !== null; m = finder.exec(str)) {
    const text = m[0].replace(/[.;:!?]+$/, "");
    spans.push([m.index, m.index + text.length]);
  }
  return spans;
}

/** The first match of `rule` that does not sit inside any URL span, or -1. */
function matchOutsideUrls(rule: RegExp, str: string, spans: readonly [number, number][]): number {
  // A fresh global copy: the rules are module-level and must not carry lastIndex.
  const scanner = new RegExp(rule.source, rule.flags.includes("g") ? rule.flags : `${rule.flags}g`);
  for (let m = scanner.exec(str); m !== null; m = scanner.exec(str)) {
    const at = m.index;
    if (!spans.some(([start, end]) => at >= start && at < end)) return at;
    if (scanner.lastIndex === m.index) scanner.lastIndex += 1;
  }
  return -1;
}

/** Rules that apply to every string, URL or not. */
const UNIVERSAL_RULES: readonly [RegExp, string][] = [
  [/\$\{/, "HOCON or environment substitution"],
  [/\{\{|\}\}/, "template placeholder"],
  [/%[A-Za-z_][A-Za-z0-9_]*%/, "Windows environment variable"],
  [/process\.env\b|\bimport\.meta\b/, "runtime environment reference"],
  [/(^|[^A-Za-z0-9_$])\$[A-Za-z_][A-Za-z0-9_]*/, "shell environment variable"],
];

/** Rules that describe a path or an include, and so do not apply to an http(s) URL. */
const PATH_RULES: readonly [RegExp, string][] = [
  [/\binclude\s*(?:file|url|classpath|required)?\s*\(?\s*["']/i, "HOCON include"],
  [/(^|[^A-Za-z0-9])file:\/\//i, "file: URL"],
  [/(^|[^A-Za-z0-9])\.{1,2}[\\/][A-Za-z0-9_.~-]/, "relative path"],
  [/(^|[^A-Za-z0-9])~[\\/]/, "home-directory path"],
  [/(^|[^A-Za-z0-9:])\/(?!\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]/, "absolute filesystem path"],
  [/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_.-]/, "Windows path"],
  [/\b[\w-]+\.(?:conf|hocon|ini|env|ya?ml|properties|toml)\b/i, "publisher-side config file"],
];

/**
 * Key names that are an include, an inheritance or an environment hook.
 *
 * `llm_info_file` and `toolbox_info_file` are in here on the vendored reference's
 * own authority: both are documented as "Path to a HOCON file", which is a
 * publisher-side path by definition and cannot survive publication.
 */
const BANNED_KEYS =
  /^(include|includes|import|imports|extends|classpath|\$ref|\$include|env|environment|env_vars?|llm_info_file|toolbox_info_file)$/i;

/** A window around the first match, so a long instruction still shows the offending part. */
function excerptAround(str: string, index: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(str.length, index + 90);
  return `${start > 0 ? "…" : ""}${str.slice(start, end)}${end < str.length ? "…" : ""}`;
}

/** Everything in `doc` that makes it depend on its publisher's machine or environment. */
export function portabilityFindings(doc: unknown): Finding[] {
  const findings: Finding[] = [];
  for (const { path, key, str } of walk(doc)) {
    if (key !== undefined && BANNED_KEYS.test(key)) {
      findings.push({ path, what: `key \`${key}\` is an include or environment hook`, excerpt: "" });
    }
    if (str === undefined) continue;
    const hit: string[] = [];
    let firstIndex = -1;
    // Universal rules apply everywhere, inside a URL included.
    for (const [regexp, what] of UNIVERSAL_RULES) {
      const match = regexp.exec(str);
      if (!match) continue;
      hit.push(what);
      if (firstIndex < 0 || match.index < firstIndex) firstIndex = match.index;
    }
    // Path rules apply only outside the URL spans in the string.
    const spans = urlSpans(str);
    for (const [regexp, what] of PATH_RULES) {
      const at = matchOutsideUrls(regexp, str, spans);
      if (at < 0) continue;
      hit.push(what);
      if (firstIndex < 0 || at < firstIndex) firstIndex = at;
    }
    if (hit.length > 0) {
      findings.push({ path, what: hit.join(", "), excerpt: excerptAround(str, firstIndex) });
    }
  }
  return findings;
}

const CREDENTIAL_KEYS =
  /^(api[_-]?keys?|apikey|secrets?|client[_-]?secret|passwords?|passwd|tokens?|access[_-]?token|refresh[_-]?token|bearer|authorization|auth[_-]?token|private[_-]?key|credentials?)$/i;

/** Values that are plainly an invitation to fill something in, not a credential. */
const PLACEHOLDER =
  /^(|-|none|null|nil|false|true|\.{3}|<[^>]*>|\{[^}]*\}|your[_-]?key|changeme|replace[_-]?me|example|todo|xxx+|\*+)$/i;

const CREDENTIAL_SHAPES: readonly [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, "OpenAI-style secret key"],
  [/\bghp_[A-Za-z0-9]{20,}/, "GitHub personal access token"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i, "bearer token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JSON Web Token"],
];

/**
 * §4: when BYOK is active the key "MUST NOT" be placed "in URLs, manifests, agent
 * network specification, prompts, action arguments, traces, analytics, or
 * peer-site requests". This finds the published-artifact half of that.
 *
 * A finding NEVER contains the value. This report gets pasted into issues and CI
 * logs; echoing the key back would turn a tool that reports a leak into a second
 * copy of it. The finding gives the path and the length, which is enough to find
 * and revoke it and nothing more.
 */
export function credentialFindings(doc: unknown): Finding[] {
  const findings: Finding[] = [];
  for (const { path, str } of walk(doc)) {
    if (str === undefined) continue;
    const leafKey = lastKeyOf(path);
    if (CREDENTIAL_KEYS.test(leafKey) && !PLACEHOLDER.test(str.trim()) && str.trim().length >= 8) {
      findings.push({
        path,
        what: `a credential-named field holds a ${str.length}-character value (not reprinted here)`,
        excerpt: "",
      });
      continue;
    }
    for (const [regexp, what] of CREDENTIAL_SHAPES) {
      if (regexp.test(str)) {
        findings.push({ path, what: `a value shaped like a ${what} (not reprinted here)`, excerpt: "" });
        break;
      }
    }
  }
  return findings;
}

/** The object key a path ends at, ignoring any array indices after it. */
function lastKeyOf(path: string): string {
  const match = /(?:^|\.)([A-Za-z0-9_$-]+)(?:\[\d+\])*$/.exec(path);
  return match?.[1] ?? "";
}

/** `path: what` plus the excerpt when there is one. */
export function formatFinding(finding: Finding): string {
  const where = finding.path === "$" ? "(document root)" : finding.path;
  return finding.excerpt ? `${where}: ${finding.what}: ${finding.excerpt}` : `${where}: ${finding.what}`;
}
