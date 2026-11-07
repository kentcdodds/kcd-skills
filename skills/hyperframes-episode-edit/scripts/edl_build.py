#!/usr/bin/env python3
"""Generate the HyperFrames timeline from edit/edl.json.

Writes:
  index.html                     root: one host per chapter
  compositions/<chapter>.html    one sub-composition per chapter (audio + video + framing)
  edit/edit-map.json             every clip with edited time <-> source time
  EDIT_MAP.md                    human-readable edit decision map for review

Pure stdlib. Re-run after editing edit/edl.json:  python3 edl_build.py <project-dir>   (default: cwd)
NOTE: Studio edits to the generated HTML are overwritten by a rebuild; make durable
changes in edl.json (or stop using the generator and edit the HTML directly).
"""
import json, os, html

import sys
ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
EDL = json.load(open(os.path.join(ROOT, "edit", "edl.json")))
W, H = 1920, 1080
CHROME_PX = 112      # macOS menu bar + browser tabs + URL bar in the screen recording
STILL_CHROME_PX = 122
ZOOM_DUR = 0.9


def r3(x):
    return round(x + 0.0, 3)


def fmt(t):
    m, s = divmod(t, 60)
    return f"{int(m)}:{s:05.2f}"


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def base_state(kind):
    if kind == "still":
        hide = STILL_CHROME_PX
        s = H / (H - hide)  # scale so the top `hide` px fall off-frame (bottom anchored)
        return {"x": r3(W * (1 - s) / 2), "y": r3(H * (1 - s)), "scale": r3(s)}
    return {"x": 0, "y": 0, "scale": 1}


def region_state(kind, cx, cy, s):
    x = clamp(W / 2 - s * cx, W * (1 - s), 0)
    y_lo = H * (1 - s)
    y = clamp(H / 2 - s * cy, y_lo, 0)
    if kind in ("chrome", "still"):
        hide = CHROME_PX if kind == "chrome" else STILL_CHROME_PX
        y = max(y_lo, min(y, -s * hide))
    return {"x": r3(x), "y": r3(y), "scale": r3(s)}


def face_state(fr):
    s = fr["scale"]
    ox, oy = fr["origin"]
    return {"x": r3(ox * (1 - s)), "y": r3(oy * (1 - s)), "scale": r3(s)}



def gs(st):
    return "{ x: %s, y: %s, scale: %s }" % (st["x"], st["y"], st["scale"])


# Layout geometry (1920x1080 canvas)
SPLIT_SCREEN = {"x": 40, "y": 200, "w": 1211, "h": 681}   # 2/3 screen panel (LEFT)
SPLIT_FACE = {"x": 1275, "y": 200, "w": 605, "h": 681}    # 1/3 face panel (RIGHT), same height
PIP_FACE = {"x": 1432, "y": 788, "w": 448, "h": 252}      # corner face (bottom-right)
TOGGLE = {"wide": "med", "med": "wide", "close": "med"}   # framing change that hides an internal (pause/disfluency) join


def panel_state(panel, scale, cx, cy):
    """Uniform scale (never stretched); horizontally/vertically cropped to keep (cx, cy) centred, clamped to the panel."""
    vw, vh = W * scale, H * scale
    x = clamp(panel["w"] / 2 - cx * scale, panel["w"] - vw, 0)
    y = clamp(panel["h"] / 2 - cy * scale, panel["h"] - vh, 0)
    return {"x": r3(x), "y": r3(y), "scale": r3(scale)}


def region_panel_state(panel, rx, ry, rw, rh):
    s = panel["w"] / rw
    return {"x": r3(-rx * s), "y": r3(-ry * s), "scale": r3(s)}


CSS = """
    #root { position: absolute; inset: 0; background: #000; overflow: hidden; font-family: Inter, sans-serif; }
    #root .shot { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; }
    #root .shot > video, #root .shot > img { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; object-fit: cover; }
    #root .cam { z-index: 1; }
    #root .shot > .band { position: absolute; left: 0; top: 0; width: 1920px; height: 112px; }
    #root .scr { z-index: 2; }
    #root .split-bg { position: absolute; inset: 0; background: #16171c; z-index: 3; }
    #root .panel { position: absolute; overflow: hidden; border-radius: 14px; z-index: 4; }
    #root .panel.pip { z-index: 6; }
    #root .panel > .pip-frame { position: absolute; inset: 0; border-radius: 14px; border: 2px solid rgba(255, 255, 255, 0.85); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25); }
    #root .panel > .shot { z-index: auto; }
    #root .adv { z-index: 2; }
    #root .lower-third { position: absolute; left: 192px; bottom: 150px; z-index: 7; }
    #root .ov { position: absolute; z-index: 8; }
    #root .ov-card { background: rgba(255, 255, 255, 0.97); color: #111318; border-radius: 20px; box-shadow: 0 14px 44px rgba(0, 0, 0, 0.38); }
    #root .ov-person { display: flex; align-items: center; gap: 26px; padding: 22px 34px 22px 22px; }
    #root .ov-person img { width: 132px; height: 132px; border-radius: 50%; object-fit: cover; }
    #root .ov-name { font-size: 46px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.05; }
    #root .ov-sub { font-size: 28px; font-weight: 400; color: #5a5f6b; margin-top: 8px; }
    #root .ov-pipe { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; background: none; box-shadow: none; }
    #root .ov-node { font-size: 42px; font-weight: 700; padding: 20px 32px; border-radius: 16px; background: rgba(255, 255, 255, 0.97); border: 2px solid #d9dde4; box-shadow: 0 12px 38px rgba(0, 0, 0, 0.38); }
    #root .ov-node.sw { background: #e9f6ed; border-color: #2e9a4b; color: #0d5c25; }
    #root .ov-arrow { font-size: 52px; font-weight: 800; color: #ffffff; padding-left: 36px; line-height: 1; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6); }
    #root .ov-imgs { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; padding: 24px 28px; }

    #root .lt-inner { background: rgba(14, 14, 18, 0.78); border-radius: 16px; padding: 22px 32px 24px; color: #fff; }
    #root .lt-l1 { font-size: 54px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
    #root .lt-l2 { font-size: 36px; font-weight: 400; color: #d8d8e0; margin-top: 6px; line-height: 1.15; }
"""

MB = ' data-hf-media-start-basis="local"'


def pstyle(p):
    return f'left:{p["x"]}px;top:{p["y"]}px;width:{p["w"]}px;height:{p["h"]}px'


def build():
    os.makedirs(os.path.join(ROOT, "compositions"), exist_ok=True)
    srcs = EDL["sources"]
    framings = EDL["framings"]
    hosts = []
    edit_map = []
    t_root = 0.0
    md_rows = []
    density = {"cuts": 0, "punch": 0, "zooms": 0, "screen_s": 0.0, "face_s": 0.0, "still_s": 0.0,
               "split_s": 0.0, "pip_s": 0.0, "ad_s": 0.0, "angle_s": 0.0, "angle_shots": 0, "front_s": 0.0, "join_covers": 0,
               "removed_s": 0.0}

    for ch in EDL["chapters"]:
        cid = ch["id"]
        items = []   # html strings
        tl = []      # js lines
        t = 0.0
        for seg in ch["segments"]:
            src = srcs[seg["source"]]
            sin, sout = seg["in"], seg["out"]
            sid = seg["id"]
            rt = seg.get("tail_roomtone")
            rt_d = rt["dur"] if rt else 0.0
            # ---- pieces (segment minus internal cuts)
            cl = sorted([c["remove"] for c in seg.get("cuts", [])])
            pieces, cur = [], sin
            for a_, b_ in cl:
                pieces.append((cur, a_)); cur = b_
                density["removed_s"] += b_ - a_
            pieces.append((cur, sout))
            ed0 = t
            pstart, acc = [], ed0
            for p0, p1 in pieces:
                pstart.append(acc); acc += p1 - p0
            dur = acc - ed0

            def loc(s_t, pieces=pieces, pstart=pstart):
                for (p0, p1), e0 in zip(pieces, pstart):
                    if s_t < p1 or (p0, p1) == pieces[-1]:
                        return e0 + (max(s_t, p0) - p0)
                return pstart[-1]

            # ---- audio
            if seg["source"] == "ad":
                pass  # the finished ad carries its own sound on its <video>
            else:
                for k, (p0, p1) in enumerate(pieces):
                    aid = f"a-{sid}" + (f"-{k + 1}" if len(pieces) > 1 else "")
                    items.append(
                        f'      <audio id="{aid}" class="clip" src="{src["audio"]}" data-start="{r3(pstart[k])}" data-duration="{r3(p1 - p0)}"'
                        f' data-media-start="{r3(p0)}" data-volume="{src["volume"]}" data-fade-in="0.02" data-fade-out="0.04" data-track-index="0"{MB}></audio>'
                    )
                    edit_map.append({"kind": "audio", "id": aid, "chapter": cid, "segment": sid,
                                     "edited_start": r3(t_root + pstart[k]), "edited_end": r3(t_root + pstart[k] + p1 - p0),
                                     "source": src["audio"], "src_in": r3(p0), "src_out": r3(p1)})
            if rt:
                items.append(
                    f'      <audio id="a-{sid}-rt" class="clip" src="{src["audio"]}" data-start="{r3(ed0 + dur)}" data-duration="{r3(rt_d)}"'
                    f' data-media-start="{r3(rt["src"])}" data-volume="{src["volume"]}" data-fade-in="0.02" data-fade-out="0.02" data-track-index="0"{MB}></audio>'
                )
                edit_map.append({"kind": "audio", "id": f"a-{sid}-rt", "chapter": cid, "segment": sid, "roomtone": True,
                                 "edited_start": r3(t_root + ed0 + dur), "edited_end": r3(t_root + ed0 + dur + rt_d),
                                 "source": src["audio"], "src_in": rt["src"], "src_out": r3(rt["src"] + rt_d)})
            cut_txt = "; ".join(f'removed {fmt(c["remove"][0])}–{fmt(c["remove"][1])} ({c["remove"][1] - c["remove"][0]:.2f} s): {c["why"]}' for c in seg.get("cuts", []))
            md_rows.append(("SEG", sid, t_root + ed0, t_root + ed0 + dur, seg["source"], sin, sout, seg["text"],
                            seg.get("note", "") + (f" **Internal cuts:** {cut_txt}" if cut_txt else "")))

            # ---- shots, split across pieces
            shots = seg["shots"]
            for i, sh in enumerate(shots):
                a = sin if i == 0 else max(sh["at"], sin)
                b = shots[i + 1]["at"] if i + 1 < len(shots) else sout
                b = min(b, sout)
                if b - a < 0.05:
                    continue
                subs = [(max(a, p0), min(b, p1)) for p0, p1 in pieces if min(b, p1) - max(a, p0) > 0.04]
                cam = sh["cam"]
                why = sh.get("why", "")
                base_n = f"{sid}-{i + 1}"
                zooms = sorted(sh.get("zooms", []), key=lambda z: z[0])
                for j, (sa, sb) in enumerate(subs):
                    n = base_n + (chr(97 + j) if len(subs) > 1 else "")
                    cs, cd = loc(sa), sb - sa
                    if i == len(shots) - 1 and j == len(subs) - 1:
                        cd += rt_d
                    label_extra = "" if j == 0 else " (join cover)"
                    if cam in ("P", "A"):
                        c = src["cams"][cam]
                        frame = sh.get("frame", "wide")
                        if j > 0 and cam == "P":
                            for _ in range(j):
                                frame = TOGGLE.get(frame, "med")
                            density["join_covers"] += 1
                        fr = framings[seg["source"]][cam][frame]
                        st = face_state(fr)
                        ms = sa + c["offset"]
                        items.append(
                            f'      <div class="shot cam" id="w-{n}"><video id="v-{n}" class="clip" src="{c["src"]}" muted playsinline'
                            f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-media-start="{r3(ms)}" data-track-index="1"{MB}></video></div>'
                        )
                        tl.append(f'    tl.set("#w-{n}", {gs(st)}, 0);')
                        label = f'{"Primary" if cam == "P" else "ANGLE"} {frame}' + (f' (x{fr["scale"]})' if fr["scale"] != 1 else "") + label_extra
                        if fr["scale"] != 1:
                            density["punch"] += 1
                        density["face_s"] += cd
                        if cam == "A":
                            density["angle_s"] += cd
                            density["angle_shots"] += 1 if j == 0 else 0
                        else:
                            density["front_s"] += cd
                        media, mstart = c["src"], ms
                    elif cam in ("S", "R"):
                        off = sh.get("offset", 0.0)
                        kind = sh.get("base", "chrome")
                        ms = sa + off
                        band = ""
                        if kind == "chrome":
                            band = (f'<div id="b-{n}" class="clip band" style="background:#{sh.get("band", "f6f8fa")}" data-start="{r3(cs)}"'
                                    f' data-duration="{r3(cd)}" data-track-index="3" data-layout-ignore></div>')
                        items.append(
                            f'      <div class="shot scr" id="w-{n}"><video id="v-{n}" class="clip" src="{src["screen"]}" muted playsinline'
                            f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-media-start="{r3(ms)}" data-track-index="2"{MB}></video>{band}</div>'
                        )
                        st = region_state(kind, *sh["initial"]) if "initial" in sh else base_state(kind)
                        for z in zooms:  # state already reached before this piece
                            if z[0] < sa - 1e-6:
                                st = base_state(kind) if z[1] == "base" else region_state(kind, z[1], z[2], z[3])
                        tl.append(f'    tl.set("#w-{n}", {gs(st)}, 0);')
                        zl = []
                        for z in zooms:
                            zt = z[0]
                            if not (sa <= zt < sb - 0.2):
                                continue
                            nst = base_state(kind) if z[1] == "base" else region_state(kind, z[1], z[2], z[3])
                            d = min(ZOOM_DUR, sb - zt - 0.05)
                            tl.append(f'    tl.fromTo("#w-{n}", {gs(st)}, {{ ...{gs(nst)}, duration: {r3(d)}, ease: "power2.inOut", immediateRender: false }}, {r3(loc(zt))});')
                            zl.append(f'{fmt(t_root + loc(zt))} → ' + ("full frame" if z[1] == "base" else f"zoom x{z[3]} @({z[1]},{z[2]})"))
                            density["zooms"] += 1
                            st = nst
                        label = ("Screen (live sync)" if cam == "S" and abs(off) < 0.5 else f"Screen RETIMED (src {fmt(ms)})") + f" [{kind}]"
                        if "initial" in sh:
                            label += f" framed x{sh['initial'][2]}"
                        if zl:
                            label += "; " + "; ".join(zl)
                        if sh.get("pip"):
                            pc = src["cams"]["P"]
                            pst = panel_state(PIP_FACE, 0.42, 1010, 420)
                            items.append(
                                f'      <div class="panel pip" style="{pstyle(PIP_FACE)}"><div class="shot" id="wp-{n}"><video id="vp-{n}" class="clip" src="{pc["src"]}" muted playsinline'
                                f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-media-start="{r3(sa + pc["offset"])}" data-track-index="4"{MB}></video></div>'
                                f'<div id="pf-{n}" class="clip pip-frame" data-start="{r3(cs)}" data-duration="{r3(cd)}" data-track-index="5" data-layout-ignore></div></div>'
                            )
                            tl.append(f'    tl.set("#wp-{n}", {gs(pst)}, 0);')
                            label += " + corner face PiP (primary, cropped x0.42)"
                            density["pip_s"] += cd
                        label += label_extra
                        density["screen_s"] += cd
                        media, mstart = src["screen"], ms
                    elif cam == "SPLIT":
                        scr = sh["screen"]
                        ms = sa + scr.get("offset", 0.0)
                        fc = sh["face"]
                        pc = src["cams"][fc.get("cam", "P")]
                        sst = region_panel_state(SPLIT_SCREEN, *scr["region"])
                        fst = panel_state(SPLIT_FACE, fc.get("scale", 0.8), *fc.get("center", [1010, 420]))
                        items.append(f'      <div id="sb-{n}" class="clip split-bg" data-start="{r3(cs)}" data-duration="{r3(cd)}" data-track-index="3" data-layout-ignore></div>')
                        items.append(
                            f'      <div class="panel" style="{pstyle(SPLIT_SCREEN)}"><div class="shot" id="ws-{n}"><video id="vs-{n}" class="clip" src="{src["screen"]}" muted playsinline'
                            f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-media-start="{r3(ms)}" data-track-index="2"{MB}></video></div></div>'
                        )
                        items.append(
                            f'      <div class="panel" style="{pstyle(SPLIT_FACE)}"><div class="shot" id="wf-{n}"><video id="vf-{n}" class="clip" src="{pc["src"]}" muted playsinline'
                            f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-media-start="{r3(sa + pc["offset"])}" data-track-index="1"{MB}></video></div></div>'
                        )
                        tl.append(f'    tl.set("#ws-{n}", {gs(sst)}, 0);')
                        tl.append(f'    tl.set("#wf-{n}", {gs(fst)}, 0);')
                        rx, ry, rw, rh = scr["region"]
                        label = (f"SPLIT 2/3 screen (src {fmt(ms)}, region {rw}x{rh}@{rx},{ry} → {SPLIT_SCREEN['w']}x{SPLIT_SCREEN['h']}) "
                                 f"| 1/3 front face (cropped, x{fc.get('scale', 0.8)}), same height {SPLIT_FACE['h']}px") + label_extra
                        density["split_s"] += cd
                        media, mstart = src["screen"], ms
                    elif cam == "AD":
                        items.append(
                            f'      <div class="shot adv" id="w-{n}"><video id="v-{n}" class="clip" src="{src["file"]}" playsinline data-has-audio="true" data-volume="{src["volume"]}"'
                            f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-media-start="{r3(sa)}" data-track-index="1"{MB}></video></div>'
                        )
                        label = "FINISHED AD, unchanged (own picture + sound)"
                        density["ad_s"] += cd
                        media, mstart = src["file"], sa
                        edit_map.append({"kind": "audio", "id": f"v-{n}", "chapter": cid, "segment": sid, "edited_start": r3(t_root + cs),
                                         "edited_end": r3(t_root + cs + cd), "source": src["file"], "src_in": r3(sa), "src_out": r3(sb), "note": "audio carried on the ad's own <video>"})
                    elif cam == "I":
                        band = ""
                        if sh.get("band"):
                            band = (f'<div id="b-{n}" class="clip band" style="background:#{sh["band"]}" data-start="{r3(cs)}"'
                                    f' data-duration="{r3(cd)}" data-track-index="3" data-layout-ignore></div>')
                        items.append(
                            f'      <div class="shot scr" id="w-{n}"><img id="i-{n}" class="clip" src="{sh["src"]}" alt=""'
                            f' data-start="{r3(cs)}" data-duration="{r3(cd)}" data-track-index="2" data-hold />{band}</div>'
                        )
                        st = base_state("deck") if sh.get("band") else (region_state("still", *sh["fit"]) if "fit" in sh else base_state("still"))
                        tl.append(f'    tl.set("#w-{n}", {gs(st)}, 0);')
                        label = ("Screen FREEZE-FRAME (exact source frame) " if sh.get("band") else "Still ") + os.path.basename(sh["src"])
                        density["still_s"] += cd
                        media, mstart = sh["src"], None
                    density["cuts"] += 1
                    edit_map.append({"kind": "visual", "id": f"w-{n}", "chapter": cid, "segment": sid, "cam": cam,
                                     "edited_start": r3(t_root + cs), "edited_end": r3(t_root + cs + cd),
                                     "source": media, "media_start": r3(mstart) if mstart is not None else None,
                                     "src_audio_in": r3(sa), "src_audio_out": r3(sb), "framing": label, "why": why})
                    md_rows.append(("SHOT", n, t_root + cs, t_root + cs + cd, label, sa, sb, why, ""))
            for ovl in seg.get("overlays", []):
                oid = f'ov-{sid}-{ovl["id"]}'
                os_, oe = loc(max(ovl["at"], sin)), loc(min(ovl["until"], sout))
                pos = ovl["pos"]
                style = ";".join(f"{k}:{v}px" for k, v in pos.items())
                if ovl["kind"] == "person":
                    inner = (f'<div class="ov-card ov-person" id="{oid}-in"><img src="{ovl["photo"]}" alt="" />'
                             f'<div><div class="ov-name">{html.escape(ovl["name"])}</div><div class="ov-sub">{html.escape(ovl["sub"])}</div></div></div>')
                elif ovl["kind"] == "pipeline":
                    nodes = ovl["nodes"]
                    inner = (f'<div class="ov-card ov-pipe" id="{oid}-in"><div class="ov-node" id="{oid}-n0">{html.escape(nodes[0]["label"])}</div>'
                             f'<div class="ov-arrow" id="{oid}-ar">↓</div><div class="ov-node sw" id="{oid}-n1">{html.escape(nodes[1]["label"])}</div></div>')
                else:
                    imgs = "".join(f'<img src="{im["src"]}" alt="" style="width:{im["w"]}px;height:auto;display:block" />' for im in ovl["images"])
                    inner = f'<div class="ov-card ov-imgs" id="{oid}-in">{imgs}</div>'
                items.append(f'      <div id="{oid}" class="clip ov" style="{style}" data-start="{r3(os_)}" data-duration="{r3(oe - os_)}" data-track-index="6" data-layout-allow-overlap>{inner}</div>')
                tl.append(f'    tl.fromTo("#{oid}-in", {{ opacity: 0, y: 18 }}, {{ opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }}, {r3(os_ + 0.02)});')
                if ovl["kind"] == "pipeline":
                    t1 = loc(nodes[1]["at"])
                    tl.append(f'    tl.fromTo(["#{oid}-ar", "#{oid}-n1"], {{ opacity: 0, y: 12 }}, {{ opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.12 }}, {r3(t1)});')
                    tl.append(f'    tl.set(["#{oid}-ar", "#{oid}-n1"], {{ opacity: 0 }}, {r3(os_)});')
                tl.append(f'    tl.fromTo("#{oid}-in", {{ opacity: 1 }}, {{ opacity: 0, duration: 0.3, ease: "power2.in", immediateRender: false }}, {r3(oe - 0.32)});')
                md_rows.append(("OVL", oid, t_root + os_, t_root + oe, f'{ovl["kind"]}: ' + ovl.get("label", ""), ovl["at"], ovl["until"], ovl.get("why", ""), ""))
                density.setdefault("overlays", []).append({"id": oid, "kind": ovl["kind"], "edited_start": r3(t_root + os_), "edited_end": r3(t_root + oe), "src_at": ovl["at"], "src_until": ovl["until"]})
            ov = seg.get("overlay")
            if ov:
                os_, oe = loc(max(ov["at"], sin)), loc(min(ov["until"], sout))
                lines = ov["lines"]
                inner = "".join(f'<div class="lt-l{1 if k == 0 else 2}">{html.escape(t_)}</div>' for k, t_ in enumerate(lines))
                items.append(
                    f'      <div id="lt-{sid}" class="clip lower-third" data-start="{r3(os_)}" data-duration="{r3(oe - os_)}" data-track-index="3">'
                    f'<div class="lt-inner" id="lt-{sid}-in">{inner}</div></div>'
                )
                tl.append(f'    tl.fromTo("#lt-{sid}-in", {{ opacity: 0, y: 14 }}, {{ opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }}, {r3(os_ + 0.02)});')
                tl.append(f'    tl.fromTo("#lt-{sid}-in", {{ opacity: 1 }}, {{ opacity: 0, duration: 0.25, ease: "power2.in", immediateRender: false }}, {r3(oe - 0.3)});')
                md_rows.append(("OVL", f"lt-{sid}", t_root + os_, t_root + oe, " / ".join(ov["lines"]), ov["at"], ov["until"], ov.get("why", ""), ""))
            if rt:
                md_rows.append(("SEG", f"{sid}-rt", t_root + ed0 + dur, t_root + ed0 + dur + rt_d, seg["source"], rt["src"], rt["src"] + rt_d,
                                "(room tone, no words)", "Breath added at a join that had only 0.1 s of natural pause; picture continues from the previous shot."))
            t += dur + rt_d
        ch_dur = t
        body = "\n".join(items)
        js = "\n".join(tl)
        doc = f"""<!doctype html>
<html>
  <head><meta charset="UTF-8" /><!-- generated by edl_build.py from edit/edl.json --></head>
  <body>
    <template>
      <style>{CSS}      </style>
      <div id="root" data-composition-id="{cid}" data-width="1920" data-height="1080" data-duration="{r3(ch_dur)}" data-layout-allow-overflow>
{body}
      </div>
      <script>
    const tl = gsap.timeline({{ paused: true }});
{js}
    window.__timelines["{cid}"] = tl;
      </script>
    </template>
  </body>
</html>
"""
        open(os.path.join(ROOT, "compositions", f"{cid}.html"), "w").write(doc)
        hosts.append((cid, ch["title"], t_root, ch_dur))
        md_rows.append(("CH", cid, t_root, t_root + ch_dur, ch["title"], None, None, "", ""))
        t_root += ch_dur

    host_html = "\n".join(
        f'      <div id="{cid}" data-composition-id="{cid}" data-composition-src="compositions/{cid}.html" data-start="{r3(s)}"'
        f' data-duration="{r3(d)}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>'
        for cid, _, s, d in hosts
    )
    index = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>{html.escape(EDL.get('title', 'Episode cut'))}</title>
    <!-- generated by edl_build.py from edit/edl.json -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #000; }}
      #main-bg {{ position: absolute; inset: 0; background: #000; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{r3(t_root)}" data-width="1920" data-height="1080">
      <div id="main-bg"></div>
{host_html}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""
    open(os.path.join(ROOT, "index.html"), "w").write(index)
    json.dump({"duration": r3(t_root), "chapters": [{"id": c, "title": ti, "start": r3(s), "end": r3(s + d)} for c, ti, s, d in hosts],
               "clips": edit_map, "density": density}, open(os.path.join(ROOT, "edit", "edit-map.json"), "w"), indent=1)

    # Markdown edit map
    L = [f"# {EDL.get('title', 'Episode cut')} — edit decision map (generated)\n",
         f"Total edited duration: **{fmt(t_root)}** ({r3(t_root)} s). Times are EDITED timeline (Studio clock); source times are the original files.\n",
         "Legend: SEG = audio segment (primary-cam audio, or the finished ad file). SHOT = visual clip on top of it.\n"]
    for row in md_rows:
        kind = row[0]
        if kind == "CH":
            continue
    cur = None
    for cid, title, s, d in hosts:
        L.append(f"\n## {fmt(s)}–{fmt(s + d)} · {title}\n")
        L.append("| Edited | Kind | Id | Source in→out | Framing / visual | Purpose / words |")
        L.append("|---|---|---|---|---|---|")
        for row in md_rows:
            kind, rid, a, b = row[0], row[1], row[2], row[3]
            if kind == "CH" or not (s - 1e-6 <= a < s + d - 1e-6):
                continue
            if kind == "SEG":
                L.append(f"| **{fmt(a)}–{fmt(b)}** | **AUDIO** | {rid} | {row[4]} {fmt(row[5])}→{fmt(row[6])} | single primary audio | “{row[7]}” — {row[8]} |")
            elif kind == "SHOT":
                L.append(f"| {fmt(a)}–{fmt(b)} | shot | {rid} | audio {fmt(row[5])}→{fmt(row[6])} | {row[4]} | {row[7]} |")
            else:
                L.append(f"| {fmt(a)}–{fmt(b)} | overlay | {rid} | {fmt(row[5])}→{fmt(row[6])} | {row[4]} | {row[7]} |")
    dd = density
    L.append(f"\n## Density\n\n- Visual shots: {dd['cuts']} over {fmt(t_root)} (avg {t_root / dd['cuts']:.1f} s per shot)\n"
             f"- Face punch-ins (static, motivated): {dd['punch']}\n- Screen zoom/pan moves: {dd['zooms']}\n"
             f"- Coverage: face {dd['face_s']:.0f} s · screen {dd['screen_s']:.0f} s · split {dd['split_s']:.0f} s · stills {dd['still_s']:.0f} s · finished ad {dd['ad_s']:.1f} s\n"
             f"- Face: front {dd['front_s']:.1f} s · angle {dd['angle_s']:.1f} s ({dd['angle_shots']} shot) · corner PiP {dd['pip_s']:.1f} s · internal-join framing covers {dd['join_covers']}\n"
             f"- Removed inside segments (false starts / fillers / pauses): {dd['removed_s']:.2f} s\n")
    open(os.path.join(ROOT, "EDIT_MAP.md"), "w").write("\n".join(L) + "\n")
    print(f"built {len(hosts)} chapters, {dd['cuts']} shots, duration {fmt(t_root)}")


if __name__ == "__main__":
    build()
