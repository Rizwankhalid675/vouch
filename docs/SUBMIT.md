# Submitting — the whole thing, in order

Everything that could be built is built, committed and live. What is left is
four steps, and three of them are paste-and-click. Allow forty minutes, most of
it the recording.

Deadline: **11 January 2027, 08:00 PT / 16:00 UTC**. Devpost saves drafts, so
step 4 can be opened and left half-finished.

---

## Step 1 — Record the narration (the only step that is work)

**Open `tools/demo-video/teleprompter.html`** (double-click it). It plays the
silent picture and shows you the line to say over each shot, in big type, with
the next one underneath and a three-second count-in. Start your recorder first —
Voice Memos, QuickTime, your phone — then press **space** on that page and read.
One take: the line is always on screen before its shot ends.

If you would rather read off paper, [`docs/demo/vouch-demo.read-aloud.txt`](demo/vouch-demo.read-aloud.txt)
is the same script without the subtitle indices and timecodes. Then:

```bash
tools/demo-video/add-voice.sh ~/Desktop/narration.m4a
```

That writes `docs/demo/vouch-demo-narrated.mp4` and leaves the silent cut alone,
so a bad take costs nothing: record again and run it again.

**Pacing.** The picture is 102.5 seconds and every shot is held as long as its
line takes to say at about 145 words a minute — an unhurried read, not a rush.
Don't hurry to hit the cuts; the script tells you if you ran long, and holds the
closing card to cover a small overrun. It refuses to write a file over two
minutes, because the rules ask for under that.

**It has to be your own voice — ElevenLabs is out.** The hackathon's front page
says the video *"must include the Entrant explaining the Project (not AI
generated)"*. The Official Rules say *"should"*, and §11 makes the Rules govern,
so a **silent** cut is a valid submission. But a synthesised voice is not the
lenient reading of that disagreement: it is the one option both documents
exclude, and the organisers put "not AI generated" in parentheses because they
expected it to be tried. `docs/DECISIONS.md` has the full reasoning. If you
truly will not record, upload the silent cut — that is the fallback, not a
generated voice.

Watch it once before you upload. If a line reads badly, change it in
`tools/demo-video/build.py` and re-run `python3 tools/demo-video/build.py` — the
durations, the subtitles and the YouTube chapters are all derived from those
lines, so they move together and cannot drift. Then
`python3 tools/demo-video/verify.py` to confirm every shot is where the cut says
it is.

---

## Step 2 — Upload to YouTube

Everything to paste is in [`docs/demo/YOUTUBE.md`](demo/YOUTUBE.md): the title,
the description, and the chapter list inside it.

| Field | Value |
|---|---|
| File | `docs/demo/vouch-demo-narrated.mp4` |
| Title | the `## Title` block in `YOUTUBE.md` (67 characters) |
| Description | the `## Description` block, whole — the chapters are inside it |
| Visibility | **Public.** Not Unlisted. |
| Audience | "No, it's not made for kids" |

**Then check two things on the video's own page**, not on the upload
confirmation — the confirmation shows what you selected, which is not the same
as what was saved:

- the badge says Public
- the chapter bar appears on the scrubber (if not, YouTube rejected the list —
  usually a chapter under ten seconds)

Copy the watch URL. Step 4 needs it.

---

## Step 3 — Have these four things open

| | |
|---|---|
| Submission text | [`docs/SUBMISSION-TEXT.md`](SUBMISSION-TEXT.md) — paste from the `## Vouch —` heading down |
| Screenshots | the four `.jpg` files in [`docs/screenshots/`](screenshots/) |
| Video URL | from step 2 |
| Repository | `https://github.com/Rizwankhalid675/vouch` |

---

## Step 4 — The Devpost form

Open the hackathon and click **Enter a submission**:
<https://cognizant-agenticweb.devpost.com/>

I have not seen this form — it is behind a login, and signing in as you is not
something I do — so these are the fields a Devpost hackathon form normally
carries, with the value for each. **Match them by meaning, not by name**, and if
a field here does not exist, skip it.

### Project name

```text
Vouch
```

### Elevator pitch / tagline (Devpost caps this at 200 characters)

```text
A deli site whose AI may describe the food, rank it and talk about it — but may never say it is safe to eat. A deterministic checker owns every verdict: the model proposes, a gate decides.
```

188 characters.

### About the project / project details

Paste [`docs/SUBMISSION-TEXT.md`](SUBMISSION-TEXT.md) from the
`## Vouch — a deli whose assistant may never tell you the food is safe` heading
to the end of the file. Everything above that heading is a note to you and does
not go in.

It already covers the three things the rules ask the description to carry: the
features and functionality, the tool shared with the community (the conformance
CLI, under Potential Impact), and how the project relates to the submission
period — it was built inside it, from nothing, which the section *Newly created
inside the submission period* states with the commit dates.

### Built with

```text
typescript, vite, vitest, html, css, netlify, neuro-san, nsdeploy, openai-api
```

### Try it out / links

```text
https://vouch-deli.netlify.app
https://marrow-point-bakery.netlify.app
https://github.com/Rizwankhalid675/vouch
```

The first is the one the rules ask for — *"the URL to your (public) open agentic
web site"*. The second is the peer origin it composes with; the third is the
source, which is also the home of the shared tool.

### Video demo link

The watch URL from step 2.

### Image gallery

Upload all four from `docs/screenshots/`.
[`docs/screenshots/README.md`](screenshots/README.md) says what each one proves,
and they are in priority order: upload at least the first two, which are the
ones that argue the case.

### Mozilla Otari fields, if the form has them

Leave empty. This project does not use Otari: the site's router is whatever
`llm_router.byok_router` in the published manifest names, and a visitor asking
for a different router is *refused* rather than quietly redirected — a security
property, not an oversight. Nothing is scored on these fields.

### Eligibility and the checkboxes

Yours. They are attestations about who you are, and I do not complete those on
anyone's behalf.

---

## Before you press Submit

- [ ] The video link opens in a private window — i.e. it really is Public
- [ ] <https://vouch-deli.netlify.app> loads in a private window
- [ ] <https://marrow-point-bakery.netlify.app> loads in a private window
- [ ] <https://github.com/Rizwankhalid675/vouch> loads while signed out
- [ ] The description pasted as text, not as one unbroken paragraph
- [ ] At least one screenshot attached
- [ ] The elevator pitch was not truncated

The first four are all the same check, and it is the one worth doing: a judge
arrives signed out. Everything in this entry was verified against the deployed
sites rather than a local build, which is how two layout defects and a missing
CORS header were found in the first place.

---

## What is not here, and why

Three things in this document are yours because of who must do them, not
because the work is unfinished:

- **the voice** — the rules require the Entrant's, and it cannot be synthesised
- **the YouTube upload** — it goes to your account, and I do not sign in to one
- **the form's attestations** — they are statements about you

Everything else — the site, both origins, the checker, the gate, five published
refusals, cross-origin composition behind consent, the conformance CLI, the
limits document, the decision record, the screenshots, the public repository,
the video, the narration script, the listing and this checklist — is done and
needs nothing from you.
