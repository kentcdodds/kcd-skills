#!/usr/bin/env python3
"""Pre-render audio QC: rebuild the EDITED narration from edit-map.json and measure every join.

  edited_audio_qc.py <edit-map.json> --wav <source_label>=<wav16k> [...] [--transcribe <ggml.bin>]

Each audio clip in edit-map.json has source/src_in/src_out/edited_start. --wav maps a substring of the
clip's `source` path to a 16 kHz analysis WAV (e.g. primary-cam=primary16k.wav  finished-ad=ad16k.wav).
Prints assembled vs timeline duration, the pause at each join (flags < 0.25 s as "tight" and > 0.9 s as
"long"; these are review candidates, not decisions), and optionally a full transcript to read across joins.
No video render required.
"""
import argparse, json, os, subprocess, tempfile
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("edit_map"); ap.add_argument("--wav", action="append", required=True); ap.add_argument("--transcribe")
a = ap.parse_args()
wmap = dict(x.split("=", 1) for x in a.wav)
m = json.load(open(a.edit_map))
au = sorted([c for c in m["clips"] if c["kind"] == "audio"], key=lambda c: c["edited_start"])
d = tempfile.mkdtemp(); parts = []; joins = []
for k, c in enumerate(au):
    src = next((w for key, w in wmap.items() if key in c["source"]), None)
    if not src: raise SystemExit(f"no --wav mapping for {c['source']}")
    o = os.path.join(d, f"p{k:04d}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(c["src_in"]), "-t", f"{c['src_out'] - c['src_in']:.3f}", "-i", src,
                    "-af", "afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse", "-ar", "16000", "-ac", "1", o], check=True)
    parts.append(o); joins.append((c["id"], c["edited_end"]))
lst = os.path.join(d, "list.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
out = os.path.join(d, "edited.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out], check=True)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-f", "s16le", "-"], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype="<i2").astype(np.float32); n = len(x) // 160
db = 20 * np.log10(np.sqrt(np.mean(x[: n * 160].reshape(n, 160) ** 2, axis=1) + 1e-9) / 32768)
print(f"assembled {len(x) / 16000:.2f}s vs timeline {m['duration']}s")
for cid, j in joins[:-1]:
    i = int(j * 100); lo = i
    while lo > 0 and db[lo] < -42: lo -= 1
    hi = i
    while hi < len(db) and db[hi] < -42: hi += 1
    g = (hi - lo) / 100
    flag = " tight?" if g < 0.25 else (" long?" if g > 0.9 else "")
    print(f"  after {cid:12s} @ {j:8.2f}s  pause {g:.2f}s{flag}")
if a.transcribe:
    r = subprocess.run(["whisper-cli", "-m", a.transcribe, "-f", out, "-np"], capture_output=True, text=True)
    print(r.stdout)
print("edited audio:", out)
