import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("xhs_capture", ROOT / "scripts/xhs-capture.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class CaptureParsingTests(unittest.TestCase):
    def test_media_index_accepts_downloader_and_normalized_names(self):
        self.assertEqual(MODULE.media_index(Path("post_12.webp")), 12)
        self.assertEqual(MODULE.media_index(Path("01.webp")), 1)
        self.assertEqual(MODULE.media_index(Path("live-03.mp4")), 3)
        self.assertIsNone(MODULE.media_index(Path("cover.webp")))

    def test_argparse_tolerates_pnpm_separator(self):
        parsed = MODULE.parse_args(["--", "--url", "https://www.xiaohongshu.com/explore/abc"])
        self.assertEqual(parsed.url, "https://www.xiaohongshu.com/explore/abc")

    def test_derives_real_publish_time_from_xiaohongshu_object_id(self):
        published = MODULE.object_id_published_at("6a969ea3000000002b011ce9")
        self.assertTrue(published.startswith("2026-09-01T17:45:07"))
        self.assertEqual(MODULE.object_id_published_at("not-a-note"), "")

    @patch.object(MODULE.subprocess, "run")
    def test_engine_failure_preserves_full_stdout_and_stderr(self, run):
        run.return_value.returncode = 1
        run.return_value.stdout = "line one\n成功 0 个，失败 1 个\n"
        run.return_value.stderr = "request timeout\ntrace detail\n"
        with self.assertRaises(RuntimeError) as caught:
            MODULE.run_engine("https://www.xiaohongshu.com/explore/abc", Path("/tmp/stage"))
        details = caught.exception.engine_diagnostics
        self.assertIn("line one", details["stdout"])
        self.assertIn("trace detail", details["stderr"])
        self.assertEqual(details["exitCode"], 1)


if __name__ == "__main__":
    unittest.main()
