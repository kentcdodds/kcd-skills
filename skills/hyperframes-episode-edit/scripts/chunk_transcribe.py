#!/usr/bin/env python3
"""Silence-anchored word-level transcript (fixes whisper timestamp drift on long, gappy recordings).

  chunk_transcribe.py <wav16k> <out_words.json> --model <ggml.bin> [--thr -46] [--max 25]

Splits on speech islands (RMS > thr, gaps < 0.5 s merged, chunks <= --max s), transcribes each chunk
with -ml 1 -sow and offsets words back to file time. Output: [[start, end, word, chunk], ...].
Whole-file whisper runs drifted by seconds after the 15-minute mark in a 33-minute OBS take; chunked runs did not.
Note: whisper (esp. medium) smooths away disfluencies — also run the small model and diff to find doubled words.
"""
import argparse, json, os, subprocess, tempfile
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("wav"); ap.add_argument("out"); ap.add_argument("--model", required=True)
ap.add_argument("--thr", type=float, default=-46.0); ap.add_argument("--max", type=float, default=25.0)
a = ap.parse_args()
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", a.wav, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype="<i2").astype(np.float32); hop = 160; n = len(x) // hop
db = 20 * np.log10(np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-9) / 32768)
sm = np.maximum.reduce([np.roll(db, i) for i in range(-2, 3)]); sp = sm > a.thr
isl, st = [], None
for i, v in enumerate(sp):
    if v and st is None: st = i
    if not v and st is not None: isl.append([st, i]); st = None
m = []
for s, e in isl:
    if m and s - m[-1][1] < 50: m[-1][1] = e
    else: m.append([s, e])
m = [z for z in m if z[1] - z[0] >= 15]
chunks, cur = [], None
for s, e in m:
    if cur and e - cur[0] <= a.max * 100 and s - cur[1] < 120: cur[1] = e
    else:
        if cur: chunks.append(cur)
        cur = [s, e]
if cur: chunks.append(cur)
d = tempfile.mkdtemp(); words = []
for k, (s, e) in enumerate(chunks):
    t0 = max(0, s / 100 - 0.25); t1 = e / 100 + 0.25; w = os.path.join(d, f"{k}.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t0:.2f}", "-t", f"{t1 - t0:.2f}", "-i", a.wav, w], check=True)
    subprocess.run(["whisper-cli", "-m", a.model, "-f", w, "-ojf", "-of", os.path.join(d, str(k)), "-ml", "1", "-sow", "-np"], capture_output=True)
    for sgm in json.load(open(os.path.join(d, f"{k}.json")))["transcription"]:
        tx = sgm["text"].strip()
        if tx and not tx.startswith("["):
            words.append([round(t0 + sgm["offsets"]["from"] / 1000, 3), round(t0 + sgm["offsets"]["to"] / 1000, 3), tx, k])
json.dump(words, open(a.out, "w"))
print(f"{len(chunks)} chunks, {len(words)} words -> {a.out}")
