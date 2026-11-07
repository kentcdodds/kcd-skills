"""Tests for scripts/episode_edit.py. Run: python3 -m unittest discover skills/hyperframes-episode-edit/tests
Synthetic fixtures only; media tests generate tiny files with ffmpeg and skip when ffmpeg is absent."""
import contextlib, copy, io, json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import episode_edit as ee  # noqa: E402

HAVE_FF = shutil.which("ffmpeg") and shutil.which("ffprobe")

EDL = {
    "title": "Fixture",
    "sources": {"main": {}, "ad": {"file": "ad.mp4", "volume": 1.0}},
    "framings": {"P": {"main": {"wide": {"scale": 1.0}, "med": {"scale": 1.18}}}},
    "chapters": [
        {"id": "open", "segments": [
            {"id": "A01", "source": "main", "in": 10.0, "out": 20.0, "cuts": [{"remove": [12.0, 12.4], "why": "doubled and"}],
             "shots": [{"at": 10.0, "cam": "P", "frame": "wide"},
                       {"at": 14.0, "cam": "S", "offset": 0.0, "zooms": [[15.0, 960, 540, 1.3], [17.0, "base"]]},
                       {"at": 18.0, "cam": "SPLIT", "screen": {"offset": 0.0, "region": [0, 112, 1211, 681]}, "face": {"cam": "P", "scale": 0.8}}],
             "overlays": [{"id": "person", "at": 10.5, "until": 13.5, "pos": {"left": 120, "top": 120}}]}]},
        {"id": "sponsor", "segments": [{"id": "AD", "source": "ad", "in": 0.0, "out": 2.0, "shots": [{"at": 0.0, "cam": "AD"}]}]},
        {"id": "close", "segments": [{"id": "C01", "source": "main", "in": 30.0, "out": 33.2, "shots": [{"at": 30.0, "cam": "P", "frame": "wide"}]}]},
    ],
}
WORDS = {"A01": [[10.0, 10.2, "So"], [10.2, 10.4, "and"], [10.4, 10.6, "and"], [10.6, 11.0, "this"], [11.0, 11.3, "is"], [11.3, 11.6, "it"]],
         "C01": [[30.2, 30.5, "Thank"], [30.5, 30.7, "you"], [30.7, 31.0, "for"], [31.0, 31.5, "watching."], [33.6, 33.9, "Okay"]]}
EDIT_MAP = {"clips": [
    {"kind": "audio", "id": "A01a", "chapter": "open", "segment": "A01", "edited_start": 0.0, "edited_end": 2.0, "src_in": 10.0, "src_out": 12.0},
    {"kind": "visual", "id": "A01-1", "chapter": "open", "segment": "A01", "cam": "P", "framing": "wide", "edited_start": 0.0, "edited_end": 4.0},
    {"kind": "visual", "id": "A01-2", "chapter": "open", "segment": "A01", "cam": "A", "framing": "angle", "edited_start": 4.0, "edited_end": 5.0},
    {"kind": "visual", "id": "A01-3", "chapter": "open", "segment": "A01", "cam": "S", "framing": "screen", "edited_start": 5.0, "edited_end": 9.0},
    {"kind": "visual", "id": "AD-1", "chapter": "sponsor", "segment": "AD", "cam": "A", "framing": "ad", "edited_start": 9.0, "edited_end": 20.0},
]}


def write(p, text):
    with open(p, "w") as f:
        f.write(text)


def run(argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = ee.main(["--json"] + argv)
    return code, json.loads(buf.getvalue())


class Fixture(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.d)

    def put(self, name, obj):
        p = os.path.join(self.d, name)
        with open(p, "w") as f:
            json.dump(obj, f)
        return p


class Bounds(Fixture):
    def test_clean_edl_passes(self):
        code, out = run(["bounds", self.put("edl.json", EDL)])
        self.assertEqual(code, 0, out)

    def test_cut_outside_segment_and_bad_split_aspect_and_stretch(self):
        e = copy.deepcopy(EDL); seg = e["chapters"][0]["segments"][0]
        seg["cuts"].append({"remove": [19.9, 21.0], "why": "x"})
        seg["shots"][2]["screen"]["region"] = [0, 112, 1211, 900]   # wrong aspect -> would stretch/letterbox
        seg["shots"][2]["face"]["scale"] = 0.5                     # face panel not covered
        seg["shots"][1]["zooms"][0][3] = 0.9                       # exposes edges
        code, out = run(["bounds", self.put("edl.json", e)])
        self.assertEqual(code, 1)
        msg = " ".join(out["errors"])
        for needle in ("not strictly inside", "aspect", "face scale", "< 1"):
            self.assertIn(needle, msg)

    def test_short_overlay_and_heavy_punch_warn(self):
        e = copy.deepcopy(EDL)
        e["chapters"][0]["segments"][0]["overlays"][0]["until"] = 11.0
        e["framings"]["P"]["main"]["close"] = {"scale": 1.6}
        code, out = run(["bounds", self.put("edl.json", e)])
        self.assertEqual(code, 0)
        self.assertTrue(any("too short" in w for w in out["warnings"]))
        self.assertTrue(any("punch" in w for w in out["warnings"]))


class Words(Fixture):
    def test_repeats_finds_doubled_word_as_candidate_only(self):
        code, out = run(["repeats", self.put("w.json", WORDS)])
        self.assertEqual(code, 0)  # candidates never fail the run
        self.assertTrue(any(c["kind"] == "doubled" and c["text"] == "and and" for c in out["candidates"]))

    def test_closing_kept_in_full(self):
        code, out = run(["closing", self.put("w.json", WORDS), self.put("edl.json", EDL), "--phrase", "thank you for watching"])
        self.assertEqual(code, 0, out)

    def test_closing_clipped_or_overrun_fails(self):
        for out_t, needle in ((31.2, "does not contain"), (34.0, "runs past")):
            e = copy.deepcopy(EDL); e["chapters"][2]["segments"][0]["out"] = out_t
            code, out = run(["closing", self.put("w.json", WORDS), self.put("edl.json", e), "--phrase", "Thank you for watching."])
            self.assertEqual(code, 1)
            self.assertIn(needle, " ".join(out["errors"]))

    def test_coverage_flags_reference_on_camera(self):
        code, out = run(["coverage", self.put("m.json", EDIT_MAP), self.put("w.json", WORDS)])
        self.assertEqual(code, 0)
        row = next(r for r in out["manifest"] if r["word"] == "this")
        self.assertEqual((row["status"], row["cam"], row["edited"]), ("REVIEW", "P", 0.6))


class Angles(Fixture):
    def test_angle_share_excludes_ad_chapter(self):
        code, out = run(["angles", self.put("m.json", EDIT_MAP), "--exclude-chapter", "sponsor"])
        self.assertEqual(code, 0)
        self.assertEqual(out["total_s"], 9.0)
        self.assertTrue(any("angle share 20.0%" in w for w in out["warnings"]))  # 1 s of 5 s camera time


@unittest.skipUnless(HAVE_FF, "ffmpeg/ffprobe not installed")
class Media(Fixture):
    def make(self, name, dur, extra=()):
        p = os.path.join(self.d, name)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=gray:s=1920x1080:r=30:d={dur}", "-f", "lavfi", "-i",
                        f"sine=f=440:d={dur}:sample_rate=48000", *extra, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ac", "2", "-shortest", p], check=True)
        return p

    def test_ad_unchanged_and_trimmed(self):
        ad = self.make("ad.mp4", 2)
        sha = ee.sha256(ad); dur = float(ee.ffprobe(ad)["format"]["duration"])
        e = copy.deepcopy(EDL); e["chapters"][1]["segments"][0]["out"] = dur
        code, out = run(["ad", ad, self.put("edl.json", e), "--sha256", sha, "--duration", str(dur)])
        self.assertEqual(code, 0, out)
        e["chapters"][1]["segments"][0]["out"] = dur - 0.5
        e["sources"]["ad"]["volume"] = 0.8
        code, out = run(["ad", ad, self.put("edl.json", e), "--sha256", "0" * 64])
        self.assertEqual(code, 1)
        msg = " ".join(out["errors"])
        for needle in ("sha256 differs", "trimmed", "volume"):
            self.assertIn(needle, msg)

    def test_qc_duration_and_log(self):
        mp4 = self.make("out.mp4", 2)
        log = os.path.join(self.d, "render.log")
        write(log, 'frame suspect; re-capturing {"frame":12}\rframe deterministic; accepted {"frame":12}\nRender complete\n')
        code, out = run(["qc", mp4, "--duration", "2", "--log", log])
        self.assertEqual(code, 0, out)
        write(log, 'suspect; re-capturing {"frame":40}\n')
        code, out = run(["qc", mp4, "--duration", "3", "--log", log])
        self.assertEqual(code, 1)
        msg = " ".join(out["errors"])
        for needle in ("duration", "unresolved", "Render complete"):
            self.assertIn(needle, msg)

    def test_pauses_reports_internal_gap_candidate(self):
        p = os.path.join(self.d, "gap.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1.2",
                        "-f", "lavfi", "-i", "sine=f=300:d=1", "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", p], check=True)
        code, out = run(["pauses", p, "--start", "0", "--end", "3.2"])
        self.assertEqual(code, 0)
        self.assertEqual(len(out["candidates"]), 1)
        self.assertAlmostEqual(out["candidates"][0]["dur"], 1.2, delta=0.1)


if __name__ == "__main__":
    unittest.main()
