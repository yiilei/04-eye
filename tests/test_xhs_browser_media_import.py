import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "xhs-browser-media-import.py"
SPEC = importlib.util.spec_from_file_location("xhs_browser_media_import", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def valid_manifest():
    return {
        "postId": "6a8bf4de0000000029018448",
        "title": "fixture",
        "author": {"name": "抖音电商设计", "id": "95380627219"},
        "sourceUrl": "https://www.xiaohongshu.com/explore/6a8bf4de0000000029018448",
        "images": [
            {"index": 1, "url": "https://sns-webpic-qc.xhscdn.com/a.webp", "width": 1080, "height": 1440},
            {"index": 2, "url": "https://sns-webpic-qc.xhscdn.com/b.webp", "width": 1080, "height": 1440},
        ],
        "livePhotos": [
            {"imageIndex": 2, "url": "https://sns-bak-v1.xhscdn.com/b.mp4"},
        ],
    }


class BrowserMediaImportTests(unittest.TestCase):
    def test_accepts_complete_xhs_cdn_manifest(self):
        parsed = MODULE.validate_manifest(valid_manifest())
        self.assertEqual(len(parsed["images"]), 2)
        self.assertEqual(parsed["livePhotos"][0]["imageIndex"], 2)

    def test_rejects_non_xhs_media_or_sensitive_fields(self):
        manifest = valid_manifest()
        manifest["images"][0]["url"] = "https://example.com/a.webp"
        with self.assertRaisesRegex(ValueError, "非小红书 CDN"):
            MODULE.validate_manifest(manifest)
        manifest = valid_manifest()
        manifest["cookie"] = "secret"
        with self.assertRaisesRegex(ValueError, "敏感字段"):
            MODULE.validate_manifest(manifest)

    def test_rejects_gapped_order_and_invalid_live_pair(self):
        manifest = valid_manifest()
        manifest["images"][1]["index"] = 3
        with self.assertRaisesRegex(ValueError, "图片序号"):
            MODULE.validate_manifest(manifest)
        manifest = valid_manifest()
        manifest["livePhotos"][0]["imageIndex"] = 9
        with self.assertRaisesRegex(ValueError, "Live Photo"):
            MODULE.validate_manifest(manifest)

    def test_cli_deletes_rejected_temporary_manifest(self):
        temporary = Path(tempfile.mkdtemp(prefix="caiguang-import-test-"))
        manifest_path = temporary / "manifest.json"
        manifest_path.write_text(json.dumps({"cookie": "forbidden"}), encoding="utf-8")
        result = subprocess.run([
            str(Path(__file__).parents[1] / "vendor" / "XHS-Downloader" / ".venv" / "bin" / "python"),
            str(SCRIPT), "--manifest", str(manifest_path), "--slug", "fixture",
        ], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(manifest_path.exists())
        temporary.rmdir()

    def test_cli_refuses_manifest_outside_system_temp_without_deleting_it(self):
        manifest_path = Path(__file__).parent / ".browser-import-must-survive.json"
        manifest_path.write_text(json.dumps(valid_manifest()), encoding="utf-8")
        try:
            result = subprocess.run([
                str(Path(__file__).parents[1] / "vendor" / "XHS-Downloader" / ".venv" / "bin" / "python"),
                str(SCRIPT), "--manifest", str(manifest_path), "--slug", "fixture",
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("系统临时目录", result.stderr)
            self.assertTrue(manifest_path.exists())
        finally:
            manifest_path.unlink(missing_ok=True)

    def test_browser_import_completion_updates_only_matching_pending_task(self):
        temporary = Path(tempfile.mkdtemp(prefix="caiguang-queue-test-"))
        queue_path = temporary / "queue.json"
        queue_path.write_text(json.dumps({
            "tasks": [
                {"id": "note-6a8bf4de0000000029018448", "type": "note", "status": "needs_browser_capture", "sourceUrl": valid_manifest()["sourceUrl"], "failureType": "parser_incompatible"},
                {"id": "note-other", "type": "note", "status": "needs_browser_capture", "sourceUrl": "https://www.xiaohongshu.com/explore/6a0000000000000000000000"},
            ]
        }), encoding="utf-8")
        with patch.object(MODULE, "QUEUE_PATH", queue_path):
            MODULE.complete_queue_task("6a8bf4de0000000029018448", {"manifest": "review/manifest.json"})
        queue = json.loads(queue_path.read_text(encoding="utf-8"))
        self.assertEqual(queue["tasks"][0]["status"], "completed")
        self.assertEqual(queue["tasks"][0]["manifest"], "review/manifest.json")
        self.assertNotIn("failureType", queue["tasks"][0])
        self.assertEqual(queue["tasks"][1]["status"], "needs_browser_capture")
        for child in temporary.iterdir():
            child.unlink()
        temporary.rmdir()


if __name__ == "__main__":
    unittest.main()
