/**
 * Errors whose message THIS runtime wrote, and can therefore show the guest.
 *
 * The transcript labels a runtime line "Hollis & Rye" — the site's own voice — so
 * only text we are willing to stand behind may go there. Anything that is not one
 * of these is reported in our own words instead, with its kind in the trace. That
 * is the general rule behind two specific leaks found at review: a router's HTTP
 * error BODY rendered in the deli's voice, and a validator message that
 * interpolated a model-chosen argument name.
 */
export class RuntimeMessage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeMessage";
  }
}
