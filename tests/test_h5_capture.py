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

    def test_classifies_gif_and_animated_webp_without_accepting_static_webp(self):
        gif = b"GIF89a" + (b"x" * 2048)
        animated_webp = b"RIFF" + (b"x" * 4) + b"WEBPVP8X" + b"ANIM" + (b"x" * 2048)
        static_webp = b"RIFF" + (b"x" * 4) + b"WEBPVP8 " + (b"x" * 2048)
        self.assertEqual(MODULE.dynamic_payload_kind(gif, "image/gif"), "gif")
        self.assertEqual(MODULE.dynamic_payload_kind(animated_webp, "image/webp"), "webp")
        self.assertIsNone(MODULE.dynamic_payload_kind(static_webp, "image/webp"))

    def test_classifies_webm(self):
        webm = b"\x1aE\xdf\xa3" + (b"x" * 2048)
        self.assertEqual(MODULE.dynamic_payload_kind(webm, "video/webm"), "webm")

    def test_detects_unpublished_activity_error_page(self):
        message = MODULE.permanent_page_error('{"success":false,"msg":"该应用不存在，请前往发布系统进行录入&发布"}')
        self.assertIn("尚未发布", message)
        self.assertIsNone(MODULE.permanent_page_error("正常活动正文"))

    def test_rejects_a_first_screen_masquerading_as_a_full_h5_capture(self):
        self.assertFalse(MODULE.capture_covers_content(2109, 6066.875, 2.34375))
        self.assertTrue(MODULE.capture_covers_content(14200, 6066.875, 2.34375))

    def test_reads_jpeg_dimensions_without_optional_image_packages(self):
        payload = b"\xff\xd8\xff\xc0\x00\x11\x08" + (2109).to_bytes(2, "big") + (1125).to_bytes(2, "big") + b"\x03" + (b"\x00" * 10)
        self.assertEqual(MODULE.jpeg_dimensions(payload), (1125, 2109))


if __name__ == "__main__":
    unittest.main()
