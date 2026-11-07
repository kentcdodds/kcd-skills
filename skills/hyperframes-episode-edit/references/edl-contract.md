# EDL contract (`edit/edl.json`)

The project's source of truth is `edit/edl.json`. It is **generated into**
`index.html`, `compositions/<chapter>.html` (one sub-composition per chapter),
`EDIT_MAP.md` and `edit/edit-map.json`. Studio hand edits are overwritten by a
rebuild, so make durable changes in the EDL.

```jsonc
{
  "sources": {
    "main": { "audio": "assets/main/primary-cam.mp4",
              "cams": { "P": {"src": "...primary...", "offset": 0.0}, "A": {"src": "...angle...", "offset": -0.0333} },
              "screen": "assets/main/screen.mp4", "volume": 1.0 },
    "ad":   { "file": "assets/<brand>-final/<FinishedAd>.mp4", "volume": 1.0 }   // finished ads are inserted UNCHANGED
  },
  "framings": { "main": { "P": { "wide": {"scale":1,"origin":[960,540]}, "med": {"scale":1.18,"origin":[1010,420]}, "close": {"scale":1.3,"origin":[1010,400]} } } },
  "chapters": [ { "id": "cold-open", "title": "…", "segments": [ {
      "id": "A01", "source": "main", "in": 129.88, "out": 156.10,          // SOURCE seconds, never edited times
      "text": "verbatim words kept", "note": "why this take / what was cut around it",
      "cuts": [ { "remove": [334.18, 334.84], "why": "doubled and + pause" } ],   // internal removals -> pieces
      "tail_roomtone": { "src": 654.3, "dur": 0.35, "why": "..." },        // optional wordless breath from the same take
      "overlays": [ { "id": "guest", "kind": "person|pipeline|cards", "at": 133.3, "until": 138.9, "pos": {"left":..,"top":..}, "why": "..." } ],
      "shots": [                                                        // `at` = SOURCE time; first shot is anchored to `in`
        { "at": 129.88, "cam": "P", "frame": "wide", "why": "purpose" },
        { "at": 133.15, "cam": "S", "base": "chrome", "band": "f6f8fa", "zooms": [[134.3, 960, 780, 1.25], [140.0, "base"]] },
        { "at": 168.45, "cam": "R", "offset": 2.05, "base": "chrome", "band": "f6f8fa" },   // retimed exact footage: screen_t = audio_t + offset
        { "at": 176.85, "cam": "I", "src": "assets/screen-stills/<exact frame>.png", "band": "f6f8fa" },  // exact freeze-frame
        { "at": 293.25, "cam": "SPLIT", "screen": {"offset": -273.25, "region": [100,112,1720,968]}, "face": {"cam":"P","scale":0.8,"center":[1010,420]} },
        { "at": 1811.96, "cam": "S", "base": "deck", "pip": true },
        { "at": 0.0, "cam": "AD" }
      ] } ] } ]
}
```

- **Every shot has a `why`.** The generated `EDIT_MAP.md` shows edited time,
  source in/out, framing label and purpose for every clip, which is what
  reviewers use to judge density.
- **Audio** is one `<audio>` per piece from the single primary track. All camera
  and screen `<video>` elements are `muted`. Finished ads keep their own sound
  on their `<video data-has-audio>`.
- **Internal `cuts`** split a segment into pieces:
  - shots are split across pieces;
  - a front-camera shot that spans a cut gets an automatic framing toggle
    (wide↔med) to hide the jump;
  - screen zoom state carries across pieces.
- **Retimed screen (`R`)** shows the exact recorded footage from a different
  source moment, used for reveal retiming. **Sync screen (`S`)** is the
  recording at the same source time the words were spoken.

- **Top-level `title`** names the generated `<title>` and the edit map heading.
- **Layout constants** live at the top of `scripts/edl_build.py`: `CHROME_PX`
  (browser chrome band), the SPLIT panels (screen 1211×681 at (40,200), face
  605×681 at (1275,200)) and the PiP (448×252 at (1432,788)).
  `episode_edit.py bounds` checks the split region's aspect against the same
  1211×681 panel; change both together.
- **`edit/edit-map.json`** lists every clip as
  `{kind: audio|visual, id, chapter, segment, edited_start, edited_end, source, src_in, src_out, cam, framing}`
  plus `density` totals. `coverage`, `angles` and `edited_audio_qc.py` read it.
- **Word files:** `[[start, end, word, ...], ...]` (whole file) or
  `{segment_id: [[start, end, word], ...]}` (per segment).
