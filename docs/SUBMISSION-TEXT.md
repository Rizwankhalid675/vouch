# Submission text — draft

The Devpost form asks for "a text description of features and functionality". This is that text,
ready to paste, with no placeholders left. The conformance CLI is cited as a clone-and-run from
the repository rather than an npm package: publishing a package is an outward-facing release
that is yours to make, and the clone route needs no decision from anyone. It was checked rather
than assumed — a fresh `--depth 1` clone of the public repository, with no `npm install`, ran the
CLI against the live site and returned `0 failed, 14 passed, 6 NOT CHECKED — exit 0`.

The three URLs are filled in. Two point at Netlify subdomains, so they change if a custom domain
is ever added.

Written to be read by a judge who has forty entries to get through and will decide in the first
twenty seconds whether this one is interesting.

---

## Vouch — a deli whose assistant may never tell you the food is safe

**Live site:** `https://vouch-deli.netlify.app` · **Second origin (the bakery):**
`https://marrow-point-bakery.netlify.app` · **Source (Apache-2.0):**
`https://github.com/Rizwankhalid675/vouch`

### The one idea

A language model may describe the menu, rank dishes, answer questions and hold a conversation.
It may **never** assert that something is safe to eat. That sentence is not a prompt
instruction — it is enforced by the architecture.

A deterministic checker reads the published ingredient data and produces every safety verdict.
The model proposes; a gate decides; the evidence survives. If the model says "this is dairy-free"
and it isn't, the claim is withheld from the page and the card beside that dish still reads
**"✕ Unsafe for what you told us — Contains dairy, through Brioche bun → Brioche → Butter →
Dairy."** Three steps down an ingredient tree, in a bun no one would think to check.

Every verdict card's contents are computed from the menu and what the guest said they avoid, and
nothing reachable from the model can change them — not the verdict, not the text. The 34 cards
beside the dishes are fixed in presence and order too. Where the model does get a say is which
dishes its *withheld* claims put a card beside, in the refusal panel — and that only ever adds a
card whose contents still come from the guest's own selection, so it cannot manufacture
reassurance. Rendering a model-supplied verdict does not compile.

### What it does

- **A real deli.** 34 dishes, every ingredient the deli knows published, ingredient trees walked
  to their leaves — and where it does not know, the card says so: one dish lists no ingredients
  at all and reads *"Ingredients — Not listed. Ask at the counter."*, and two ingredients are
  published as contents-unknown. It works with JavaScript off and with no agent involved at all.
- **Three verdicts, not two.** `safe` is never said. A clear dish reads "✓ No conflict found",
  and every card names what it was *not* looking at: "From the published ingredient list. Not a
  statement about the kitchen, and not medical advice." Where the data does not say, the answer
  is **"We don't know"** — never a guess in the guest's favour.
- **Five visible refusals**, where the specification asks for four: an invalid network, a
  composition cycle, an over-budget turn, a denied origin, and a missing provider key. Three
  deliberately broken networks are **published** at `/broken/`, so the refusals can be watched
  rather than taken on trust.
- **Cross-origin composition behind real consent.** Another site's published agent network loads
  after approval and runs locally, in the visitor's browser, on the visitor's own router. **The
  fetch does not start until the visitor approves** — the request is not issued and then
  cancelled; the call is never made, which the test suite holds by leaving the consent promise
  unresolved and asserting that nothing was fetched. Consent is a gate, not a notice. A second
  contact asks again. And a peer's prose is not a safety source that happens to be remote:
  it goes through the **same gate** as our own model's, so a peer claiming a dish is dairy-free
  has that claim *withheld* and the card beside the dish still shows this site's own verdict,
  computed from this site's own ingredient data. Nothing fetches a peer's ingredient data; trust
  does not transit a hyperlink.
- **The visitor's key, the visitor's browser.** No key ships with the site and the site never
  pays for inference. The key reaches the router the visitor chose and nothing else, and they can
  delete it. The checker and the verdict cards work with no key at all, because they never call a
  model — a visitor with no AI provider still gets every safety answer the site can give.
- **A conformance checker anyone can run**, against any agentic site, not just this one. It
  reports what it cannot check as **NOT CHECKED** with the reason, because "I did not look",
  "I looked and it is wrong" and "this cannot be checked from here" are three different
  statements. Apache 2.0, no runtime dependencies, nothing to install:

  ```
  git clone https://github.com/Rizwankhalid675/vouch
  node vouch/tools/conformance/cli.ts https://your-site.example/agents/your_network
  ```

### Why the refusals are the point

Four of the specification's seven interoperability checks are about refusing, and about what a
peer must *not* receive. Most demonstrations show the happy path. This one is built so the
failures are reproducible on a public URL: the broken networks are published, the budgets are
documented with their arithmetic, and the consent flow can be declined on camera.

### What it does not do, stated plainly

`docs/LIMITS.md` is part of the project rather than an appendix to it, and it is long on purpose.
It records that the gate suppresses **true** warnings as well as false ones — a model correctly
saying "this is not dairy-free" is refused exactly like one saying it is — and that this is
survivable only because the verdict appears *beside* the prose rather than through it. It records
a residual leak class in the gate's vocabulary list, says which of the two defences is the weaker
one, and tells a reader where to push. It records that the tracked-allergen set is a deliberate
EU-14 intersection with what this menu's data contains, with every exclusion named.

A project arguing that systems should say what they do not know would be a poor advertisement for
itself if its own record were tidied. `docs/DECISIONS.md` keeps the mistakes too, including the
consent card that once said "This reads only." about running a stranger's code, and the test that
passed while it did.

### Built on

The specification's own vocabulary throughout, with the Neuro SAN agent-network schema and the
nsDeploy browser runtime (both Apache 2.0, Cognizant AI Lab) vendored and cited in
`docs/vendor/PROVENANCE.md` so that "which parts are yours?" has a one-file answer. The published
router configuration was validated by running upstream's **actual** router selector against our
published manifest — which found a defect 123 passing tests had not.

No server-side code. Static hosting, browser execution, visitor-supplied inference.
