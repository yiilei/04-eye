import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "xhs-h5-capture.py"
SPEC = importlib.util.spec_from_file_location("xhs_h5_capture", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class H5CaptureTests(unittest.TestCase):
    def test_accepts_real_mp4_signature(self):
        payload = b"\x00\x00\x00\x18ftypmp42" + (b"x" * 2048)
        self.assertTrue(MODULE.valid_mp4(payload))

    def test_rejects_html_or_tiny_payload(self):
        self.assertFalse(MODULE.valid_mp4(b"<html>not a video</html>" * 100))
        self.assertFalse(MODULE.valid_mp4(b"ftyp"))


if __name__ == "__main__":
    unittest.main()
