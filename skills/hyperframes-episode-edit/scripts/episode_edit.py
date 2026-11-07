#!/usr/bin/env python3
"""Deterministic evidence checks for a transcript-driven HyperFrames episode edit.

Python 3 standard library only; uses ffmpeg/ffprobe when a command reads media.
Every command prints evidence or CANDIDATES. Nothing here cuts, reorders, or scores taste.

  episode_edit.py bounds   <edl.json>                         EDL time bounds, offsets, crop/aspect/safe-area checks
  episode_edit.py pauses   <media> --start S --end E [--min 0.45] [--noise -45]   internal pause CANDIDATES
  episode_edit.py repeats  <words.json>                       doubled-word / restart CANDIDATES
  episode_edit.py closing  <words.json> <edl.json> --phrase "..."   is the full recorded closing line kept?
  episode_edit.py coverage <edit-map.json> <words_by_segment.json> [--names A,B]   screen-reference manifest
  episode_edit.py angles   <edit-map.json> [--exclude-chapter sponsor]          camera totals (front vs angle)
  episode_edit.py ad       <ad.mp4> <edl.json> [--sha256 HEX] [--duration S]    finished ad inserted unchanged?
  episode_edit.py qc       <render.mp4> --duration S [--log render.log] [--fps 30]  export codec/stream/hash QC

Exit code 0 = no errors (warnings/candidates may still print); 1 = at least one error.
"""
import argparse, hashlib, json, re, subprocess, sys

W, H = 1920, 1080
TITLE_SAFE = (W * 0.1, H * 0.1, W * 0.9, H * 0.9)
DEICTIC = re.compile(r"^(this|these|here|look|show|see|those)$")


class Report:
    def __init__(self):
        self.errors, self.warnings, self.notes = [], [], []

    def err(self, m): self.errors.append(m)
    def warn(self, m): self.warnings.append(m)
    def note(self, m): self.notes.append(m)

    def done(self, as_json=False, extra=None):
        out = {"errors": self.errors, "warnings": self.warnings, "notes": self.notes, **(extra or {})}
        if as_json:
            print(json.dumps(out, indent=1))
        else:
            for k, pre in (("notes", "  "), ("warnings", "WARN "), ("errors", "ERROR ")):
                for m in out[k]:
                    print(pre + m)
            print(f"-- {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
        return 1 if self.errors else 0


def readj(path):
    with open(path) as f:
        return json.load(f)


def fmt(t):
    return f"{int(t // 60)}:{t % 60:05.2f}"


def norm(w):
    return re.sub(r"[^a-z']", "", w.lower())


def load_words(path):
    """Accepts [[start, end, word, ...], ...] or {segment: [[start, end, word], ...]}."""
    d = readj(path)
    return d if isinstance(d, dict) else {"_": d}


def iter_shots(edl):
    for ch in edl["chapters"]:
        for seg in ch["segments"]:
            yield ch, seg


# ---------------------------------------------------------------- bounds
def cmd_bounds(a):
    edl = readj(a.edl); r = Report()
    panels = {"SPLIT_SCREEN": (1211, 681), "SPLIT_FACE": (605, 681)}
    prev_out = {}
    for ch, seg in iter_shots(edl):
        sid, i, o = seg["id"], seg["in"], seg["out"]
        if not o > i:
            r.err(f"{sid}: out {o} <= in {i}")
        src = seg.get("source")
        if src != "ad" and prev_out.get(src) is not None and i < prev_out[src][1] and i > prev_out[src][0]:
            r.warn(f"{sid}: in {fmt(i)} overlaps previous {src} segment range (check intentional reuse/reorder)")
        prev_out[src] = (i, o)
        cuts = sorted(c["remove"] for c in seg.get("cuts", []))
        for a0, b0 in cuts:
            if not (i < a0 < b0 < o):
                r.err(f"{sid}: cut {a0}-{b0} not strictly inside [{i}, {o}]")
            if b0 - a0 > 3:
                r.warn(f"{sid}: cut {a0}-{b0} is {b0 - a0:.2f}s — large for an internal cut")
        for (a0, b0), (a1, b1) in zip(cuts, cuts[1:]):
            if a1 < b0:
                r.err(f"{sid}: cuts overlap {a0}-{b0} / {a1}-{b1}")
        ats = [sh["at"] for sh in seg["shots"]]
        if ats != sorted(ats):
            r.err(f"{sid}: shot 'at' times not ascending")
        for k, sh in enumerate(seg["shots"]):
            if k > 0 and not (i <= sh["at"] < o):
                r.err(f"{sid}: shot {k + 1} at {sh['at']} outside [{i}, {o})")
            cam = sh["cam"]
            off = sh.get("offset", sh.get("screen", {}).get("offset", 0.0))
            if cam in ("R", "S", "SPLIT") and sh["at"] + off < 0:
                r.err(f"{sid}: shot {k + 1} media time {sh['at'] + off:.2f} < 0")
            for z in sh.get("zooms", []):
                if z[1] != "base":
                    zs = z[3]
                    if zs < 1:
                        r.err(f"{sid}: zoom scale {zs} < 1 exposes frame edges")
                    if zs > 2.0:
                        r.warn(f"{sid}: zoom x{zs} upsamples > 2x (legibility/softness)")
                    if not (0 <= z[1] <= W and 0 <= z[2] <= H):
                        r.err(f"{sid}: zoom centre ({z[1]},{z[2]}) outside source frame")
                if not (sh["at"] <= z[0]):
                    r.err(f"{sid}: zoom at {z[0]} before its shot starts ({sh['at']})")
            if cam == "SPLIT":
                rx, ry, rw, rh = sh["screen"]["region"]
                if rx < 0 or ry < 0 or rx + rw > W or ry + rh > H:
                    r.err(f"{sid}: split region {sh['screen']['region']} outside source frame")
                pw, ph = panels["SPLIT_SCREEN"]
                if abs((rw / rh) - (pw / ph)) / (pw / ph) > 0.02:
                    r.err(f"{sid}: split region aspect {rw / rh:.3f} != panel {pw / ph:.3f} (would letterbox/stretch)")
                fs = sh.get("face", {}).get("scale", 0.8)
                if fs * H < ph:
                    r.err(f"{sid}: face scale {fs} leaves the {ph}px face panel uncovered")
        for ov in seg.get("overlays", []):
            if not (i <= ov["at"] < ov["until"] <= o + 1e-6):
                r.err(f"{sid}: overlay {ov['id']} {ov['at']}-{ov['until']} outside segment")
            if ov["until"] - ov["at"] < 1.5:
                r.warn(f"{sid}: overlay {ov['id']} on screen {ov['until'] - ov['at']:.2f}s — likely too short to read")
            p = ov.get("pos", {})
            if "left" in p and "top" in p and not (TITLE_SAFE[0] * 0.5 <= p["left"] <= W and TITLE_SAFE[1] * 0.5 <= p["top"] <= H):
                r.warn(f"{sid}: overlay {ov['id']} origin ({p['left']},{p['top']}) near/outside action-safe area")
    for cam, fr in edl.get("framings", {}).items():
        for c, frames in fr.items():
            for name, f in frames.items():
                if f["scale"] < 1:
                    r.err(f"framing {cam}.{c}.{name} scale {f['scale']} < 1 exposes edges")
                if f["scale"] > 1.4:
                    r.warn(f"framing {cam}.{c}.{name} punch x{f['scale']} upsamples 1080p heavily")
    return r.done(a.json)


# ---------------------------------------------------------------- pauses
def cmd_pauses(a):
    r = Report()
    p = subprocess.run(["ffmpeg", "-nostats", "-ss", str(a.start), "-t", str(a.end - a.start), "-i", a.media, "-vn",
                        "-af", f"silencedetect=noise={a.noise}dB:d={a.min}", "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    cands = []
    for s, e in zip(starts, ends):
        s0, e0 = a.start + s, a.start + e
        if s0 <= a.start + 0.05 or e0 >= a.end - 0.05:
            continue  # edge padding is reported separately by the join check
        cands.append({"start": round(s0, 2), "end": round(e0, 2), "dur": round(e0 - s0, 2),
                      "suggest_keep": a.keep, "candidate_trim": round(max(0, e0 - s0 - a.keep), 2)})
        r.note(f"CANDIDATE pause {fmt(s0)}-{fmt(e0)} ({e0 - s0:.2f}s): could trim {max(0, e0 - s0 - a.keep):.2f}s, keeping a {a.keep}s breath — listen first")
    return r.done(a.json, {"candidates": cands})


# ---------------------------------------------------------------- repeats
def cmd_repeats(a):
    r = Report(); words = load_words(a.words); cands = []
    for seg, ws in words.items():
        toks = [norm(w[2]) for w in ws]
        for k in range(len(ws) - 1):
            if toks[k] and toks[k] == toks[k + 1]:
                cands.append({"segment": seg, "at": ws[k][0], "kind": "doubled", "text": f"{ws[k][2]} {ws[k + 1][2]}"})
            if ws[k][2].rstrip().endswith(("--", "-", "—")):
                cands.append({"segment": seg, "at": ws[k][0], "kind": "restart", "text": ws[k][2]})
            if toks[k] in ("uh", "um", "er", "erm"):
                cands.append({"segment": seg, "at": ws[k][0], "kind": "filler", "text": ws[k][2]})
        for k in range(len(ws) - 3):
            if toks[k] and toks[k] + toks[k + 1] == toks[k + 2] + toks[k + 3]:
                cands.append({"segment": seg, "at": ws[k][0], "kind": "repeated-bigram", "text": " ".join(w[2] for w in ws[k:k + 4])})
        for n in (3, 4):  # repeated phrase start (classic false start: "so let me show you … so let me show you")
            for k in range(len(ws) - 2 * n):
                head = toks[k:k + n]
                if all(head) and head in [toks[j:j + n] for j in range(k + n, min(len(ws) - n + 1, k + n + 12))]:
                    cands.append({"segment": seg, "at": ws[k][0], "kind": f"repeated-{n}gram", "text": " ".join(w[2] for w in ws[k:k + n])})
                    break
    seen = set()
    for c in sorted(cands, key=lambda c: (c["segment"], c["at"])):
        key = (c["segment"], round(c["at"], 1), c["kind"])
        if key in seen:
            continue
        seen.add(key)
        r.note(f"CANDIDATE {c['kind']:15s} {c['segment']} @{fmt(c['at'])}: '{c['text']}' — verify with probe_onsets + splice_test; intentional emphasis stays")
    return r.done(a.json, {"candidates": cands})


# ---------------------------------------------------------------- closing
def cmd_closing(a):
    r = Report(); words = load_words(a.words); edl = readj(a.edl)
    target = [norm(x) for x in a.phrase.split() if norm(x)]
    flat = sorted((w for ws in words.values() for w in ws), key=lambda w: w[0])
    toks = [norm(w[2]) for w in flat]
    hits = [k for k in range(len(toks) - len(target) + 1) if toks[k:k + len(target)] == target]
    if not hits:
        r.err(f"closing phrase not found in transcript: '{a.phrase}'")
        return r.done(a.json)
    k = hits[-1]; ps, pe = flat[k][0], flat[k + len(target) - 1][1]
    nxt = flat[k + len(target)][0] if k + len(target) < len(flat) else None
    last = [seg for _, seg in iter_shots(edl) if seg.get("source") != "ad"][-1]
    r.note(f"closing phrase source {fmt(ps)}-{fmt(pe)}; next word {fmt(nxt) if nxt else 'none'}; last segment {last['id']} {fmt(last['in'])}-{fmt(last['out'])}")
    if not (last["in"] <= ps and last["out"] >= pe):
        r.err(f"last segment does not contain the full closing line (needs out >= {pe:.2f}; has {last['out']:.2f})")
    if nxt is not None and last["out"] > nxt:
        r.err(f"last segment runs past the closing into the next words at {fmt(nxt)}")
    if last["out"] - pe > 2.0:
        r.warn(f"{last['out'] - pe:.2f}s after the last word — check frames for the speaker turning away")
    return r.done(a.json, {"phrase_start": ps, "phrase_end": pe, "next_word": nxt})


# ---------------------------------------------------------------- coverage
def cmd_coverage(a):
    r = Report(); m = readj(a.edit_map); words = load_words(a.words)
    names = {x.strip().lower() for x in (a.names or "").split(",") if x.strip()}
    vis = [c for c in m["clips"] if c["kind"] == "visual"]
    aud = [c for c in m["clips"] if c["kind"] == "audio"]
    rows = []
    for seg, ws in words.items():
        for k, w in enumerate(ws):
            t = norm(w[2]); base = re.sub(r"'s$", "", t)
            if not (DEICTIC.match(t) or base in names):
                continue
            e = next((c["edited_start"] + (w[0] - c["src_in"]) for c in aud if c.get("segment") == seg and c["src_in"] - 0.05 <= w[0] <= c["src_out"] + 0.05), None)
            if e is None:
                continue
            v = next((c for c in vis if c["edited_start"] <= e < c["edited_end"]), None)
            cam = v["cam"] if v else None
            status = "REVIEW" if cam in ("P", "A", None) else "screen"
            rows.append({"segment": seg, "word": w[2], "src": round(w[0], 2), "edited": round(e, 2), "cam": cam,
                         "visual": v["framing"] if v else None, "context": " ".join(x[2] for x in ws[max(0, k - 3):k + 5]), "status": status})
            r.note(f"{status:6s} {seg:6s} src {fmt(w[0])} ed {fmt(e)} | {cam or '?':5s} | {rows[-1]['context']}")
    r.note(f"{sum(x['status'] == 'REVIEW' for x in rows)} references on camera: a human checks the source screen at each src time (showing something -> use exact footage; rhetorical -> face/overlay)")
    return r.done(a.json, {"manifest": rows})


# ---------------------------------------------------------------- angles
def cmd_angles(a):
    r = Report(); m = readj(a.edit_map)
    excl = set(a.exclude_chapter or [])
    vis = [c for c in m["clips"] if c["kind"] == "visual" and c.get("chapter") not in excl]
    tot = sum(c["edited_end"] - c["edited_start"] for c in vis)
    by = {}
    for c in vis:
        k = c.get("cam"); by.setdefault(k, [0, 0.0]); by[k][1] += c["edited_end"] - c["edited_start"]
        if not re.search(r"[b-z]$", c["id"]):  # count shots, not internal-cut pieces (…a, …b)
            by[k][0] += 1
    cam_time = by.get("P", [0, 0])[1] + by.get("A", [0, 0])[1]
    for k, (n, s) in sorted(by.items(), key=lambda kv: -kv[1][1]):
        r.note(f"{k:6s} {n:3d} shots {s:7.1f}s  {100 * s / tot:5.1f}% of picture")
    ang = by.get("A", [0, 0.0])
    share = 100 * ang[1] / cam_time if cam_time else 0
    r.note(f"angle = {ang[0]} shots / {ang[1]:.1f}s = {100 * ang[1] / tot if tot else 0:.1f}% of picture, {share:.1f}% of camera-only time")
    if share > a.max_angle_pct:
        r.warn(f"angle share {share:.1f}% of camera time exceeds {a.max_angle_pct}% (front-default policy: angle is a rare accent)")
    seq = [c.get("cam") for c in sorted(vis, key=lambda c: c["edited_start"])]
    alt = sum(1 for x, y, z in zip(seq, seq[1:], seq[2:]) if x == "P" and y == "A" and z == "P")
    if alt >= 3:
        r.warn(f"{alt} P→A→P alternations — looks like automatic alternation")
    return r.done(a.json, {"by_cam": by, "total_s": tot})


# ---------------------------------------------------------------- ad
def ffprobe(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels",
                        "-of", "json", path], capture_output=True, text=True, check=True)
    return json.loads(p.stdout)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def cmd_ad(a):
    r = Report(); edl = readj(a.edl); info = ffprobe(a.ad)
    dur = float(info["format"]["duration"]); dig = sha256(a.ad)
    r.note(f"ad {dur:.3f}s sha256 {dig}; streams " + ", ".join(f"{s['codec_type']}:{s['codec_name']}" for s in info["streams"]))
    if a.sha256 and a.sha256 != dig:
        r.err("ad sha256 differs from the recorded finished-ad identity")
    if a.duration and abs(a.duration - dur) > 0.04:
        r.err(f"ad duration {dur:.3f}s differs from expected {a.duration:.3f}s")
    segs = [s for _, s in iter_shots(edl) if s.get("source") == "ad"]
    if len(segs) != 1:
        r.err(f"expected exactly one ad segment in the EDL, found {len(segs)}")
    for s in segs:
        if abs(s["in"]) > 1e-3 or abs(s["out"] - dur) > 0.04:
            r.err(f"ad segment plays {s['in']}-{s['out']}, not the whole file 0-{dur:.3f} (trimmed?)")
        if s.get("cuts") or s.get("overlays") or s.get("overlay"):
            r.err("ad segment has cuts/overlays — finished ads go in unchanged")
        if [sh["cam"] for sh in s["shots"]] != ["AD"]:
            r.err("ad segment must be a single AD shot (own picture + sound)")
    vol = edl.get("sources", {}).get("ad", {}).get("volume", 1.0)
    if vol != 1.0:
        r.err(f"ad volume {vol} != 1.0 (level changed)")
    return r.done(a.json, {"duration": dur, "sha256": dig})


# ---------------------------------------------------------------- qc
def cmd_qc(a):
    r = Report(); info = ffprobe(a.render)
    v = [s for s in info["streams"] if s["codec_type"] == "video"]; au = [s for s in info["streams"] if s["codec_type"] == "audio"]
    dur = float(info["format"]["duration"])
    if len(v) != 1 or len(au) != 1:
        r.err(f"expected 1 video + 1 audio stream, got {len(v)} + {len(au)}")
    if v:
        s = v[0]
        r.note(f"video {s['codec_name']} {s.get('profile')} {s.get('width')}x{s.get('height')} {s.get('pix_fmt')} {s.get('r_frame_rate')}")
        if (s.get("width"), s.get("height")) != (a.width, a.height):
            r.err(f"resolution {s.get('width')}x{s.get('height')} != {a.width}x{a.height}")
        if s.get("r_frame_rate") != f"{a.fps}/1":
            r.err(f"frame rate {s.get('r_frame_rate')} != {a.fps}/1")
        if s["codec_name"] != "h264":
            r.warn(f"video codec {s['codec_name']} (expected h264 for delivery)")
    if au:
        r.note(f"audio {au[0]['codec_name']} {au[0].get('sample_rate')} Hz {au[0].get('channels')} ch")
    if abs(dur - a.duration) > 1.5 / a.fps:
        r.err(f"duration {dur:.3f}s != expected {a.duration:.3f}s (±1 frame)")
    if a.log:
        with open(a.log, errors="replace") as f:
            txt = f.read().replace("\r", "\n")
        sus = set(re.findall(r'suspect; re-capturing \{[^}]*"frame":(\d+)', txt))
        acc = set(re.findall(r'deterministic; accepted \{[^}]*"frame":(\d+)', txt))
        r.note(f"renderer blank-frame suspects {len(sus)}, accepted {len(acc)}")
        if sus - acc:
            r.err(f"unresolved blank-frame suspects: {sorted(sus - acc)[:10]}")
        if "Render complete" not in txt:
            r.err("render log has no 'Render complete'")
    dig = sha256(a.render)
    r.note(f"sha256 {dig}  duration {dur:.3f}s")
    return r.done(a.json, {"sha256": dig, "duration": dur})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("bounds"); p.add_argument("edl")
    p = sub.add_parser("pauses"); p.add_argument("media"); p.add_argument("--start", type=float, required=True); p.add_argument("--end", type=float, required=True)
    p.add_argument("--min", type=float, default=0.45); p.add_argument("--noise", type=float, default=-45); p.add_argument("--keep", type=float, default=0.3)
    p = sub.add_parser("repeats"); p.add_argument("words")
    p = sub.add_parser("closing"); p.add_argument("words"); p.add_argument("edl"); p.add_argument("--phrase", required=True)
    p = sub.add_parser("coverage"); p.add_argument("edit_map"); p.add_argument("words"); p.add_argument("--names")
    p = sub.add_parser("angles"); p.add_argument("edit_map"); p.add_argument("--exclude-chapter", action="append"); p.add_argument("--max-angle-pct", type=float, default=10.0)
    p = sub.add_parser("ad"); p.add_argument("ad"); p.add_argument("edl"); p.add_argument("--sha256"); p.add_argument("--duration", type=float)
    p = sub.add_parser("qc"); p.add_argument("render"); p.add_argument("--duration", type=float, required=True); p.add_argument("--log")
    p.add_argument("--fps", type=int, default=30); p.add_argument("--width", type=int, default=1920); p.add_argument("--height", type=int, default=1080)
    a = ap.parse_args(argv)
    return {"bounds": cmd_bounds, "pauses": cmd_pauses, "repeats": cmd_repeats, "closing": cmd_closing, "coverage": cmd_coverage,
            "angles": cmd_angles, "ad": cmd_ad, "qc": cmd_qc}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
