#!/usr/bin/env python3
"""Find true word onsets by sliding-start transcription (whisper.cpp `whisper-cli`).

  probe_onsets.py <wav16k> <start> <end> [step=0.05] --model <ggml-*.bin> [--window 1.8]

Prints each start time where the transcript of [t, t+window] changes. The first time a word
disappears from the head of the transcript is where that word starts — far more reliable than
whisper word offsets. Use it to place cuts around fillers / doubled words, then splice_test.py.
"""
import argparse, os, subprocess, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("wav"); ap.add_argument("start", type=float); ap.add_argument("end", type=float)
ap.add_argument("step", type=float, nargs="?", default=0.05)
ap.add_argument("--model", required=True); ap.add_argument("--window", type=float, default=1.8)
ap.add_argument("--prompt", default="Um, uh, and, and.")
a = ap.parse_args()
tmp = os.path.join(tempfile.mkdtemp(), "p.wav")
t, prev = a.start, None
while t <= a.end + 1e-6:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-t", str(a.window), "-i", a.wav, "-af", "afade=t=in:d=0.01,adelay=300", tmp], check=True)
    r = subprocess.run(["whisper-cli", "-m", a.model, "-f", tmp, "-nt", "-np", "--prompt", a.prompt], capture_output=True, text=True)
    txt = " ".join(r.stdout.split())[:70]
    if txt != prev:
        print(f"{t:.2f}: {txt}", flush=True); prev = txt
    t += a.step
