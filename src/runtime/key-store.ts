/**
 * Tenet Three, our half of it: the visitor's provider key lives in this browser,
 * in origin-scoped storage, and nowhere else. OURS, written here.
 *
 * Deliberately NOT adapted from upstream's byok.js. That module keeps a list of
 * profiles and, on loopback hosts, mirrors them into a host cookie so settings
 * follow nsDeploy between ports. A cookie is sent to the serving host on every
 * request, which is a wider surface than this site needs, and the mirroring is
 * the kind of thing that is safe upstream and quietly wrong here. One profile,
 * one storage key, no cookie, no URL, ever.
 *
 * What the spec requires of us (§4, L352-373):
 *  - the key is attached only to model requests sent to the selected router;
 *  - it is NOT placed in URLs, manifests, network definitions, prompts, action
 *    arguments, traces, analytics, or peer-site requests;
 *  - the user MUST be able to delete it.
 * The first two are enforced where requests are made (src/runtime/llm.ts and
 * src/runtime/boot.ts) and pinned by tests on captured payloads. The third is
 * `forget()` below, and the button that calls it.
 *
 * What it does NOT give you, said plainly because the spec says it plainly
 * (L377-380): storage scoped to this origin is not isolation from other
 * JavaScript running on this origin. Our page loads no third-party script, which
 * is the only mitigation that actually holds.
 */

/** One storage key, versioned, namespaced to this site. */
export const KEY_ITEM = "vouch-byok-v1";

export interface KeyProfile {
  /** The visitor's provider credential. Never logged, never sent anywhere but the router. */
  key: string;
  /** An explicit router base URL, when the visitor chose one instead of the published route. */
  router?: string;
  /** A model name, when the visitor chose one instead of the network's hint. */
  model?: string;
}

/** A Storage-shaped thing. `localStorage` is one; a test can pass its own. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's own origin-scoped store, or null where there is none (or it throws). */
export function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Touch it: a blocked or full store throws here rather than later.
    localStorage.getItem(KEY_ITEM);
    return localStorage;
  } catch {
    return null;
  }
}

export class KeyStore {
  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  /** True when this browser has somewhere to keep a key at all. */
  get available(): boolean {
    return this.storage !== null;
  }

  read(): KeyProfile | null {
    if (!this.storage) return null;
    let raw: string | null;
    try {
      raw = this.storage.getItem(KEY_ITEM);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      const rec = parsed as Record<string, unknown>;
      if (typeof rec["key"] !== "string" || rec["key"] === "") return null;
      const out: KeyProfile = { key: rec["key"] };
      if (typeof rec["router"] === "string" && rec["router"] !== "") out.router = rec["router"];
      if (typeof rec["model"] === "string" && rec["model"] !== "") out.model = rec["model"];
      return out;
    } catch {
      return null;
    }
  }

  /** The key alone, or "" when there is none. Callers pass this to the router and to nothing else. */
  key(): string {
    return this.read()?.key ?? "";
  }

  save(profile: KeyProfile): boolean {
    if (!this.storage || !profile.key) return false;
    try {
      this.storage.setItem(KEY_ITEM, JSON.stringify(profile));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete the stored profile. The visitor MUST be able to do this (L373), so it
   * is reachable from the same panel the key is entered in, and a test asserts
   * the store is empty afterwards rather than asserting that this was called.
   */
  forget(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(KEY_ITEM);
    } catch {
      /* nothing kept, nothing to delete */
    }
  }
}
