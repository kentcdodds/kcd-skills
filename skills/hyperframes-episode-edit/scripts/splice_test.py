#!/usr/bin/env python3
"""Audition a cut WITHOUT rendering: splice source audio around removal ranges and re-transcribe.

  splice_test.py <wav16k> "<a1>-<b1>[,<a2>-<b2>...]" --model <small.bin> [--model <medium.bin>] [--pad 3.5]

Keeps [a1-pad, a1) + [b1, a2) + ... + [bn, bn+pad] with 12 ms fades and prints each model's transcript.
Accept a cut only when every model reads the intended words with no clipped phoneme
(e.g. "GitHub"->"Git", "costs less"->"caught", "long"->"low" are rejects). This is a review
candidate check, not a taste decision; a human still listens before final.
"""
import argparse, os, subprocess, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("wav"); ap.add_argument("cuts"); ap.add_argument("--model", action="append", required=True)
ap.add_argument("--pad", type=float, default=3.5)
a = ap.parse_args()
cl = [tuple(float(x) for x in c.split("-")) for c in a.cuts.split(",")]
d = tempfile.mkdtemp(); keep = []; t = cl[0][0] - a.pad
for x, y in cl:
    keep.append((t, x)); t = y
keep.append((t, cl[-1][1] + a.pad))
parts = []
for j, (x, y) in enumerate(keep):
    af = []
    if j > 0: af.append("afade=t=in:d=0.012")
    if j < len(keep) - 1: af.append("areverse,afade=t=in:d=0.012,areverse")
    p = os.path.join(d, f"{j}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{x:.3f}", "-t", f"{y - x:.3f}", "-i", a.wav] + (["-af", ",".join(af)] if af else []) + [p], check=True)
    parts.append(p)
out = os.path.join(d, "spliced.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y"] + sum([["-i", p] for p in parts], []) + ["-filter_complex", "".join(f"[{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1", out], check=True)
for m in a.model:
    r = subprocess.run(["whisper-cli", "-m", m, "-f", out, "-nt", "-np", "--prompt", "Um, uh, and, and, so."], capture_output=True, text=True)
    print(f"{os.path.basename(m)}: {' '.join(r.stdout.split())}")
print("spliced audio:", out)
