#!/usr/bin/env python3
"""Find when the screen recording changes (deck reveals, tab flips, scrolls) to place/retime screen shots.

  screen_changes.py <screen.mp4> <out_dir> [--fps 10] [--thr 0.4]
  screen_changes.py <out_dir> --sheet <start> <end> [--step 0.5]     contact sheet of a range (needs ImageMagick montage)

Decodes once to a tiny grayscale stream (192x108 @10 fps; ~3.5 min for 33 min of 1080p on Apple silicon),
saves frame-diff energy, prints change episodes (start, end, peak). Settled windows between episodes are the
safe in/out points for exact footage; very short settled windows (< ~0.5 s) are freeze-frame candidates.
"""
import argparse, os, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("a"); ap.add_argument("b", nargs="?"); ap.add_argument("--fps", type=int, default=10)
ap.add_argument("--thr", type=float, default=0.4); ap.add_argument("--sheet", nargs=2, type=float); ap.add_argument("--step", type=float, default=0.5)
x = ap.parse_args(); W, H = 192, 108
if x.sheet:
    d = x.a; v = np.memmap(os.path.join(d, "small.gray"), dtype=np.uint8, mode="r").reshape(-1, H, W)
    args = ["montage"]; t = x.sheet[0]
    while t <= x.sheet[1]:
        p = os.path.join(d, f"f_{t:.2f}.pgm"); open(p, "wb").write(f"P5 {W} {H} 255\n".encode() + v[int(t * x.fps)].tobytes())
        args += ["-label", f"{t:.2f}", p]; t += x.step
    subprocess.run(args + ["-tile", "8x", "-geometry", "288x162+2+2", os.path.join(d, f"sheet_{x.sheet[0]:.0f}.png")], check=True)
    raise SystemExit
os.makedirs(x.b, exist_ok=True); g = os.path.join(x.b, "small.gray")
if not os.path.exists(g):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", x.a, "-vf", f"fps={x.fps},scale={W}:{H},format=gray", "-f", "rawvideo", g], check=True)
v = np.memmap(g, dtype=np.uint8, mode="r").reshape(-1, H, W)
dd = np.abs(v[1:].astype(np.int16) - v[:-1].astype(np.int16)).mean(axis=(1, 2)); np.save(os.path.join(x.b, "diff.npy"), dd)
st = None
for i, val in enumerate(list(dd > x.thr) + [False]):
    t = (i + 1) / x.fps
    if val and st is None: st = t
    if not val and st is not None:
        print(f"{st:8.1f}-{t:8.1f}  dur {t - st:4.1f}  peak {float(dd[int(st * x.fps) - 1:int(t * x.fps)].max()):.1f}"); st = None
