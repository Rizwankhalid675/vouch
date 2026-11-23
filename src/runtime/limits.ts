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
   * How many network documents one composition may chain together — §3.1's
   * "composition depth" at the site level, as distinct from `maxDepth`, which
   * bounds delegation *inside* one network.
   *
   * A cycle check does not make this redundant: A → B → C → D → … of distinct
   * networks is not a cycle and would walk forever.
   */
  maxComposedNetworks: number;
}

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
 * Thrown when an execution limit is reached. Carries the budget, its limit and
 * what had been spent, because all three are in the message the guest reads.
 */
export class BudgetError extends RuntimeMessage {
  constructor(
    readonly budget: keyof Limits,
    readonly limit: number,
    readonly spent: number,
  ) {
    super(
      joinSiteText(
        budget === "maxSessionModelCalls"
          ? siteText`Execution limit reached: ${budget} is ${limit} and this conversation has already used ${spent}.`
          : siteText`Execution limit reached: ${budget} is ${limit} and this turn has already used ${spent}.`,
        ours(" Nothing further was run, and nothing was left half-done."),
        budget === "maxSessionModelCalls"
          ? ours(" Start a new conversation to carry on; the verdict beside each dish is unaffected either way.")
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
