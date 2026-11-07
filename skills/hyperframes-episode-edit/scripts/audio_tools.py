#!/usr/bin/env python3
"""Audio helpers for transcript-driven edits. Needs ffmpeg + numpy.

  extract <media> <out.wav>                      16 kHz mono WAV for analysis/whisper
  env <wav> <start> <end> [step=0.05]            print RMS dB envelope (max per step) — find real dips at cut points
  sync <ref_media> <other_media> [at=120] [dur=40]  audio cross-correlation offset (s): other = ref + offset
  quiet <wav> <start> <end> [thr=-45] [min=0.45]  list quiet runs (internal pauses) in a range

Lessons: whisper word offsets drift (often 0.3–0.5 s early after long silences); never cut on them alone.
A cut point must sit in a measured dip; confirm with probe_onsets.py + splice_test.py.
"""
import subprocess, sys
import numpy as np


def load(wav):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float32)


def env_db(x, hop=160):
    n = len(x) // hop
    return 20 * np.log10(np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-9) / 32768)


def main():
    cmd, *a = sys.argv[1:]
    if cmd == "extract":
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a[0], "-vn", "-ac", "1", "-ar", "16000", a[1]], check=True)
    elif cmd == "env":
        db = env_db(load(a[0])); s, e = float(a[1]), float(a[2]); st = float(a[3]) if len(a) > 3 else 0.05
        t = s
        while t < e:
            i = int(t * 100); print(f"{t:8.2f} {db[i:i + max(1, int(st * 100))].max():6.1f}"); t += st
    elif cmd == "sync":
        at = float(a[2]) if len(a) > 2 else 120.0; dur = float(a[3]) if len(a) > 3 else 40.0
        def seg(m):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(at), "-t", str(dur), "-i", m, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
            return np.frombuffer(raw, dtype="<i2").astype(np.float32)
        p, o = seg(a[0]), seg(a[1]); n = min(len(p), len(o)); p, o = p[:n], o[:n]
        c = np.fft.irfft(np.fft.rfft(p, 2 * n) * np.conj(np.fft.rfft(o, 2 * n)))
        k = int(np.argmax(np.abs(c))); k = k - 2 * n if k > n else k
        print(f"offset {-k / 16000:+.4f} s (other media time = ref time {-k / 16000:+.4f}); corr {np.max(np.abs(c)) / (np.linalg.norm(p) * np.linalg.norm(o)):.3f}")
    elif cmd == "quiet":
        db = env_db(load(a[0])); s, e = float(a[1]), float(a[2])
        thr = float(a[3]) if len(a) > 3 else -45.0; mn = float(a[4]) if len(a) > 4 else 0.45
        q = db[int(s * 100):int(e * 100)] < thr; st = None
        for k, v in enumerate(list(q) + [False]):
            if v and st is None: st = k
            if not v and st is not None:
                if (k - st) / 100 >= mn: print(f"{s + st / 100:.2f}-{s + k / 100:.2f} ({(k - st) / 100:.2f}s)")
                st = None
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
