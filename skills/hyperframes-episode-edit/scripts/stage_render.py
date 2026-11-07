#!/usr/bin/env python3
"""Re-create a render-stage copy of a production HyperFrames project, changing only source paths.

  stage_render.py <project-dir> <stage-dir> [--set sources.main.cams.P.src=assets/proxy.mp4 ...]

Use it when the render machine needs different media files (e.g. H.264 proxies for HEVC
originals that decode black in headless Chrome) without touching production. It rsyncs the
project (minus caches/renders), applies each dotted --set to edit/edl.json, records what changed
under "_render_stage", and rebuilds with edl_build.py. It never renders, and it refuses a stage
dir that is the project itself or contains it. Diff the stage against production before rendering:
the only differences must be the --set paths.
"""
import argparse, json, os, subprocess, sys

ap = argparse.ArgumentParser(); ap.add_argument("project"); ap.add_argument("stage")
ap.add_argument("--set", action="append", default=[], metavar="DOTTED.PATH=VALUE")
a = ap.parse_args()
prod, stage = os.path.realpath(a.project), os.path.realpath(a.stage)
if stage == prod or prod.startswith(stage + os.sep) or stage.startswith(prod + os.sep):
    sys.exit("stage dir must be outside the production project")
excl = [".hyperframes", ".transcode-cache", "proxies", "renders", "output", "node_modules", "REMOTE_PREVIEW.md"]
subprocess.run(["rsync", "-a"] + sum([["--exclude", e] for e in excl], []) + [prod + "/", stage + "/"], check=True)
p = os.path.join(stage, "edit", "edl.json"); e = json.load(open(p)); changed = {}
for kv in a.set:
    path, val = kv.split("=", 1); node = e; keys = path.split(".")
    for k in keys[:-1]:
        node = node[k]
    if keys[-1] not in node:
        sys.exit(f"--set {path}: key does not exist in the EDL (refusing to invent structure)")
    changed[path] = {"from": node[keys[-1]], "to": val}; node[keys[-1]] = val
e["_render_stage"] = {"note": "RENDER-STAGE COPY; only these source paths differ from production. Do not hand-edit; re-stage.", "changed": changed}
json.dump(e, open(p, "w"), indent=2, ensure_ascii=False)
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "edl_build.py"), stage], check=True)
print("staged:", stage, json.dumps(changed))
