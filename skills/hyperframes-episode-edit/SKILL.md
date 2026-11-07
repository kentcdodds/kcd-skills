---
name: hyperframes-episode-edit
description:
  Cut a recorded talking-head + screen-recording episode (multicam, optional finished sponsor ad) into
  a HyperFrames video from a transcript-driven EDL, with deterministic evidence checks and a human
  review gate before any render. Use when editing a full episode or revising one from reviewer
  feedback: false starts, pacing, camera choice, screen coverage, overlays, sponsor insertion, closing,
  layout/legibility, render QC.
---

# HyperFrames episode edit

Turn raw takes (front camera, optional angle camera, screen recording, optional
finished ad) into a reviewed HyperFrames cut. The EDL is the source of truth, a
generator writes the compositions, and scripts produce **evidence and
candidates**. They never make taste calls, and they never cut on their own. A
human approves the browser preview before anything renders.

Read the `hyperframes` / `hyperframes-core` / `hyperframes-cli` skills for the
composition contract and CLI. Pin the CLI version
(`npx --yes hyperframes@<x.y.z>`).

## Tools (all in `scripts/`; every path is an argument)

| Script                   | Use                                                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `episode_edit.py`        | **Entry command.** `bounds`, `pauses`, `repeats`, `closing`, `coverage`, `angles`, `ad`, `qc`. Run with `--json` for machine output. Exit code 1 means an error; candidates never fail a run. |
| `edl_build.py <project>` | `edit/edl.json` → `index.html`, `compositions/<chapter>.html`, `edit/edit-map.json`, `EDIT_MAP.md`. Contract: [references/edl-contract.md](references/edl-contract.md).                       |
| `audio_tools.py`         | `extract` (16 kHz WAV), `env` (RMS envelope), `sync` (multicam offset), `quiet`                                                                                                               |
| `chunk_transcribe.py`    | Silence-anchored chunked whisper word timings, so long gappy takes don't drift                                                                                                                |
| `probe_onsets.py`        | True word onsets by sliding-start transcription                                                                                                                                               |
| `splice_test.py`         | Audition a cut without rendering: splice and re-transcribe with 1–N models                                                                                                                    |
| `edited_audio_qc.py`     | Rebuild the edited narration from the edit map; pause at every join; full transcript                                                                                                          |
| `screen_changes.py`      | Change episodes in the screen recording, plus contact sheets of a range                                                                                                                       |
| `swap-media.mjs`         | Review-mirror-only `src` swap to temporary links or proxies. Refuses without a `REVIEW_MIRROR` marker, checks content hashes, never prints URLs.                                              |
| `stage_render.py`        | Render-stage copy with explicit `--set` source overrides; rebuilds; never renders                                                                                                             |
| `render_qc.sh`           | Post-render black, silence and loudness scan, frame grabs, sha256                                                                                                                             |

Dependencies: ffmpeg/ffprobe, whisper.cpp `whisper-cli` with ggml `small.en` +
`medium.en`, Python 3 (numpy for the audio scripts), Node ≥ 22, and ImageMagick
`montage` (contact sheets only). Tests:
`python3 -m unittest discover -s skills/hyperframes-episode-edit/tests`.

## Editorial taste (the brief; reviewers enforce it)

- **The words are the edit.** Keep the speaker's actual words and best take.
  Never paraphrase, reorder meaning, or generate speech.
- **Front camera by default.** Use the angle camera rarely, as a justified
  accent (well under 10% of camera time), and never alternate automatically.
  `angles` reports the share.
- **Natural pacing.** Remove false starts, restarts, doubled words ("and and")
  and genuine hesitation pauses. Keep breaths, emphasis and rhythm. Cap the
  quiet at joins (lead-in ≈ 0.22 s, tail ≈ 0.26 s). If no clean boundary exists,
  keep the word and say why.
- **Show what is being talked about.** Every "this / here / look / let me show
  you" and every named tool, file or person gets checked against the source
  screen at that moment:
  - **Demonstration:** use the exact recorded footage at the spoken reference.
    Retime it if needed, or use an exact freeze-frame when the page only settles
    briefly. When the speaker opens a list of things (for example, each skill
    file), show each one properly, not a montage of blurs.
  - **Rhetorical:** stay on the face, or add a meaningful on-camera overlay.
    Motion graphics built from the speaker's own words, real logos and authentic
    assets all work. A named person gets a **verified real photo and name**,
    never a generated likeness, with provenance recorded.
- **Both kinds of coverage.** Talking-head stretches deserve purposeful
  overlays, and demonstrations deserve the authentic screen. Neither replaces
  the other.
- **Layouts:**
  - **Screen-only:** for code, dense pages and benchmark cards.
  - **SPLIT:** screen 2/3 on the left and face 1/3 on the right, at the same
    height, cropped, never stretched. Use it for readable slides or files beside
    the speaker.
  - **Corner PiP:** only where that corner is empty in every zoom state.
- **Legibility first.** Mask browser chrome with a page-colored band and show
  the page at 1:1 instead of upscaling it. A zoom lands on the thing named, then
  restores. A sliced title or a half-visible card is a reject. Overlays stay up
  long enough to read (≥ 1.5 s plus reading time).
- **Purposeful punches.** Framing punches (×1.18 / ×1.3) mark key lines or hide
  a join. Don't use them as decoration.
- **Finished sponsor ads go in unchanged.** Use the ad's own picture and sound,
  with no trim, level change, overlay or reconstruction from raw. If more than
  one finished candidate exists, ask. Place it where the episode has earned
  attention, not in the first minute.
- **Complete closing.** Keep the full recorded sign-off. Search every session
  for it, end after the last word plus a natural hold, and check frames for the
  speaker turning away.

## Workflow

1. **Inventory (read-only).** ffprobe every source and record durations and
   codecs. Never modify originals. Back up the approved state before each
   revision.
2. **Sync and transcribe.**
   - `audio_tools.py extract` makes the 16 kHz WAVs, and `audio_tools.py sync`
     gives each camera's offset (store it in `cams.<X>.offset`).
   - `chunk_transcribe.py` with **both** small and medium. Medium smooths
     disfluencies, so diff the two to find doubles and false starts.
3. **Paper edit.** Write the EDL in **source** seconds, with a `why` on every
   shot, then run `edl_build.py`.
4. **Cleanup candidates.** `episode_edit.py repeats words.json` and
   `episode_edit.py pauses primary16k.wav --start S --end E` list candidates.
   For each one you act on:
   - `probe_onsets.py` gives the true onset, and `audio_tools.py env` must show
     a real dip.
   - `splice_test.py` with two models must read the intended words with no
     clipped phoneme. Rejected examples: "GitHub" → "Git", "long" → "low".
   - Record each removal in `cuts[]` with a `why`.
5. **Coverage audit.**
   `episode_edit.py coverage edit/edit-map.json words_by_segment.json --names <tools,people>`.
   - For every REVIEW row, look at the screen at that source time
     (`screen_changes.py` episodes plus a contact sheet).
   - Decide whether it is a demonstration or rhetorical, then fix it.
   - Write a coverage table: edited time, beat, source time, reference → visual,
     verdict.
6. **Structural checks.** All must pass before preview handoff:
   - `episode_edit.py bounds edit/edl.json`: times, cut ordering, offsets, split
     aspect, crop scale and safe area.
   - `episode_edit.py closing words.json edit/edl.json --phrase "<the full sign-off>"`
   - `episode_edit.py angles edit/edit-map.json --exclude-chapter <ad chapter>`
   - `episode_edit.py ad <finished-ad.mp4> edit/edl.json --sha256 <recorded> --duration <recorded>`
   - `edited_audio_qc.py edit/edit-map.json --wav ...`: assembled duration
     equals the timeline; read the transcript across every join.
   - `npx hyperframes lint` and `check --json`; `snapshot` every landed zoom,
     split and overlay.
7. **Preview and change map.**
   - Run `npx hyperframes preview --background --port <p> --no-open`, confirm it
     responds, and hand over `http://127.0.0.1:<p>/#project/<name>`.
   - Include a change map: what changed, edited and source times, removed
     seconds, angle totals, layouts and overlays, plus what was deliberately
     kept and why.
   - For a remote reviewer, bundle only HTML, EDL, maps and small authentic
     images, and use `swap-media.mjs` in the mirror.
8. **Render (only after explicit approval of the current preview).**
   - If the render machine needs different media, run `stage_render.py` and diff
     the stage against production; only the `--set` paths may differ.
   - Do one full render with `--quality delivery --strict --no-best-effort` and
     a versioned filename.
   - Then run
     `episode_edit.py qc out.mp4 --duration <timeline> --log render.log` and
     `render_qc.sh`.
   - Copy with no-clobber, keep a verified backup before replacing anything, and
     check sha256 on both sides.

## Known traps

- Whole-file whisper timestamps drift by seconds on long takes, and word offsets
  often run 0.3–0.5 s early after silences. Never cut on whisper offsets alone.
- HEVC Main10 decodes **black** in Linux and headless Chrome, while local
  snapshots look fine. Use H.264 review proxies with no B-frames, verified
  frame-aligned and mapped only in the mirror or stage.
- A border or shadow on an untimed container stays on screen as an empty box.
  Style timed elements only.
- Studio edits to generated HTML are overwritten by a rebuild. Durable changes
  go in the EDL.
- Reviewer notes can describe a stale build. Compare their timestamps and
  duration with the current build first.
- If a safety check blocks a command (an outward-facing one especially), report
  the exact reason. Don't repackage it or route it another way.

## Human decisions (never automated)

Take choice, keep-or-cut on a borderline filler, overlay taste, sponsor
placement, the semantic verdict on each coverage row, and the go-ahead to render
or publish.
