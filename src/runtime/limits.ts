/**
 * Execution bounds, and the single error that reports reaching one. OURS, written here.
 *
 * Lifted out of `loop.ts` by Task 7 because the loop is no longer the only thing
 * that spends a budget: composing a peer network chain spends one too, and both
 * must report the overrun the same way — with the budget AND the spend on screen.
 * A refusal that says "over budget" without the figures is indistinguishable from
 * a bug, which is the confusion the spec's §6 demonstration exists to rule out.
 *
 * §3.1 requires finite limits on "composition depth, agent invocations, remote
 * calls, concurrency, and elapsed execution time". Five axes; this file carries
 * all of them except concurrency, which is structural: the loop awaits every call
 * in sequence and the composition walk is depth-first, so the number of requests
 * in flight at once is one.
 */

import { RuntimeMessage, joinSiteText, ours, siteText, type SiteText } from "./errors.ts";

export interface Limits {
  /**
   * Model calls within ONE TURN, across every agent. Per turn, not per session:
   * the runaway this exists to stop is a turn that will not finish, and a
   * session-lifetime budget instead bricks the assistant after N questions with
   * no way back, which is worse than no limit for anyone actually using the site.
   */
  maxModelCalls: number;
  /** Agent-to-agent delegations within one turn. */
  maxAgentCalls: number;
  /** How deep delegation may nest. */
  maxDepth: number;
  /** Tool-call rounds within a single turn. */
  maxRounds: number;
  /**
   * Model calls for the whole conversation. A backstop against a page left open
   * all day, set far above any honest session, and recoverable: reaching it tells
   * the guest to start a new conversation, and the panel has a control that does.
   */
  maxSessionModelCalls: number;
  /**
   * Wall-clock milliseconds one turn may occupy — §3.1's "elapsed execution time",
   * the one axis Task 6 left open.
   *
   * Per turn for the same reason as `maxModelCalls`: a session-lifetime clock
   * would end the conversation at a wall-clock hour with nothing wrong.
   *
   * Enforced at two points, and both are needed. At each step boundary, which
   * stops a turn that is making progress too slowly to be worth continuing; and
   * by aborting the in-flight request, which is the only thing that bounds a
   * router that accepts a POST and never answers. Without the abort this limit
   * would be a lie for exactly the case it exists for.
   */
  maxElapsedMs: number;
  /**
   * How many network documents one composition may fetch in TOTAL. A count, not
   * a depth: the walk is depth-first over a graph, so a wide composition spends
   * it as surely as a deep one, and that is intended — what is being bounded is
   * how much of the web one press of Load can pull in.
   *
   * It is this project's answer to §3.1's "composition depth" at the site level,
   * as distinct from `maxDepth`, which bounds delegation *inside* one network.
   * It was called a depth here and in LIMITS.md §2.6 until fix round 2; it never
   * was one.
   *
   * A cycle check does not make it redundant: A → B → C → D → … of distinct
   * networks is not a cycle and would walk until the host gave out.
   */
  maxComposedNetworks: number;
}

/**
 * The defaults.
 *
 * `maxElapsedMs` and `maxComposedNetworks` are **arbitrary picks**: generous
 * enough that no honest session reaches them, finite as §3.1 requires, and
 * derived from no measurement at all. The other five were set by Task 6. If one
 * of these numbers starts to matter, measure it rather than reasoning from this
 * comment.
 */
export const DEFAULT_LIMITS: Limits = {
  maxModelCalls: 16,
  maxAgentCalls: 12,
  maxDepth: 3,
  maxRounds: 6,
  maxSessionModelCalls: 300,
  maxElapsedMs: 60_000,
  maxComposedNetworks: 4,
};

/**
 * Milliseconds as a person says them: `1000` → "1 second", `62500` → "62.5
 * seconds". A bare `2000` beside a bare `1000` in a sentence with no unit in it
 * is a developer log line, and the people who read these strings are a guest and
 * a judge watching a demo.
 *
 * Built the long way round — digits through `siteText`, unit word through `ours`
 * — because `siteText` filters out anything containing a space and `ours` takes
 * only a literal. That is the mechanism working rather than being fought: there
 * is no call in this file that could put an untrusted value in a sentence even
 * by accident.
 */
export function seconds(ms: number): SiteText {
  const value = ms / 1000;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return joinSiteText(siteText`${shown}`, shown === "1" ? ours(" second") : ours(" seconds"));
}

/** A count with its unit: `1` + "model call" / "model calls". */
function count(n: number, one: SiteText, many: SiteText): SiteText {
  return joinSiteText(siteText`${n}`, n === 1 ? one : many);
}

/**
 * What reaching a budget says, in English.
 *
 * Both figures, as the brief required — but named by what they bound rather than
 * by the field identifier that holds them. `maxComposedNetworks is 2` tells a
 * guest nothing; "a composition may load 2 published networks" tells them what
 * stopped. The identifier stays in the trace, which is where a developer looks,
 * so nothing is lost by taking it out of the sentence.
 */
function budgetSentence(budget: keyof Limits, limit: number, spent: number): SiteText {
  const opener = ours("Execution limit reached: ");
  switch (budget) {
    case "maxElapsedMs":
      return joinSiteText(opener, ours("this turn may take "), seconds(limit), ours(", and has already taken "), seconds(spent), ours("."));
    case "maxSessionModelCalls":
      return joinSiteText(
        opener,
        ours("this conversation may make "),
        count(limit, ours(" model call"), ours(" model calls")),
        ours(", and has already made "),
        siteText`${spent}`,
        ours("."),
      );
    case "maxModelCalls":
      return joinSiteText(
        opener,
        ours("this turn may make "),
        count(limit, ours(" model call"), ours(" model calls")),
        ours(", and has already made "),
        siteText`${spent}`,
        ours("."),
      );
    case "maxAgentCalls":
      return joinSiteText(
        opener,
        ours("this turn may call "),
        count(limit, ours(" agent"), ours(" agents")),
        ours(", and has already called "),
        siteText`${spent}`,
        ours("."),
      );
    case "maxRounds":
      return joinSiteText(
        opener,
        ours("this turn may take "),
        count(limit, ours(" round"), ours(" rounds")),
        ours(" of tool calls, and has already taken "),
        siteText`${spent}`,
        ours("."),
      );
    case "maxDepth":
      return joinSiteText(
        opener,
        ours("delegation may nest "),
        count(limit, ours(" level"), ours(" levels")),
        ours(" deep, and is already "),
        siteText`${spent}`,
        ours(" deep."),
      );
    case "maxComposedNetworks":
      return joinSiteText(
        ours("Refused: a composition may load "),
        count(limit, ours(" published network"), ours(" published networks")),
        ours(", and this one has already loaded "),
        siteText`${spent}`,
        ours("."),
      );
  }
}

/**
 * Thrown when an execution limit is reached. Carries the budget, its limit and
 * what had been spent, because all three are in what the guest reads — the
 * figures in words, the identifier in the trace.
 */
export class BudgetError extends RuntimeMessage {
  constructor(
    readonly budget: keyof Limits,
    readonly limit: number,
    readonly spent: number,
  ) {
    super(
      joinSiteText(
        budgetSentence(budget, limit, spent),
        ours(" Nothing further was run, and nothing was left half-done."),
        budget === "maxSessionModelCalls"
          ? ours(" Start a new conversation to carry on; the verdict beside each dish is unaffected either way.")
          : budget === "maxComposedNetworks"
            ? ours(" No network from this composition was run.")
            : ours(" Ask again, more simply, and this turn starts from a fresh budget."),
      ),
    );
    this.name = "BudgetError";
  }
}

/**
 * One turn's wall clock.
 *
 * `now` is injected rather than read from `Date`, so a test can move the clock
 * deterministically and the overrun is pinned by behaviour rather than by a
 * sleep. The abort controller is separate, and real, because a hung request does
 * not come back to be asked what time it is.
 */
export class TurnClock {
  private startedAt: number;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly limitMs: number,
    private readonly now: () => number,
  ) {
    this.startedAt = now();
  }

  /** Begin a turn: reset the clock and arm the abort. */
  start(): void {
    this.stop();
    this.startedAt = this.now();
    const controller = new AbortController();
    this.controller = controller;
    if (Number.isFinite(this.limitMs) && this.limitMs > 0) {
      this.timer = setTimeout(() => controller.abort(), this.limitMs);
    }
  }

  /** End a turn. Always called, so a finished turn leaves no timer behind. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** The signal every model call made during this turn is given. */
  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  /** True once the abort has fired, whatever the injected clock says. */
  get overran(): boolean {
    return this.controller?.signal.aborted === true;
  }

  elapsed(): number {
    return this.now() - this.startedAt;
  }

  /** The error for this overrun, so both enforcement points report it identically. */
  error(): BudgetError {
    return new BudgetError("maxElapsedMs", this.limitMs, this.elapsed());
  }

  /** Throws when this turn has already used its wall-clock budget. */
  check(): void {
    if (this.overran || (this.limitMs > 0 && this.elapsed() >= this.limitMs)) throw this.error();
  }
}

/** The error text a reached budget shows the guest. Exported so a doc or demo can quote it. */
export function budgetMessage(budget: keyof Limits, limit: number, spent: number): SiteText {
  return new BudgetError(budget, limit, spent).siteMessage;
}
