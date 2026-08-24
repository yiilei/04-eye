import importlib.util
import unittest
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


if __name__ == "__main__":
    unittest.main()
