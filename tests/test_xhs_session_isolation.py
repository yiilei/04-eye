import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
PYTHON = ROOT / "vendor" / "xhs-cli" / ".venv" / "bin" / "python"
XHS = ROOT / "vendor" / "xhs-cli" / ".venv" / "bin" / "xhs"
AUTH = ROOT / "vendor" / "xhs-cli" / "xhs_cli" / "auth.py"
CAPTURE = ROOT / "scripts" / "xhs-capture.py"


class ChromeSessionIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="caiguang-session-test-")
        self.config = Path(self.temporary.name)
        self.env = {**os.environ, "XHS_CLI_CONFIG_DIR": str(self.config), "XHS_CLI_DISABLE_BROWSER_COOKIE": "1"}

    def tearDown(self):
        self.temporary.cleanup()

    def run_python(self, source: str):
        return subprocess.run(
            [str(PYTHON), "-c", source], cwd=ROOT, env=self.env,
            text=True, capture_output=True,
        )

    def test_legacy_and_chrome_imported_sessions_are_not_loaded(self):
        cookie_file = self.config / "cookies.json"
        cookies = {"a1": "legacy", "web_session": "legacy-session"}
        for payload in ({"cookies": cookies}, {"sessionSource": "chrome_imported", "cookies": cookies}):
            cookie_file.write_text(json.dumps(payload), encoding="utf-8")
            result = self.run_python("from xhs_cli.auth import get_cookie_string; print(get_cookie_string())")
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "None")

    def test_isolated_qrcode_session_is_loaded(self):
        result = self.run_python(
            "from xhs_cli.auth import save_cookies, get_cookie_string; "
            "save_cookies('a1=isolated; web_session=isolated-session'); "
            "print(bool(get_cookie_string()))"
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "True")
        saved = json.loads((self.config / "cookies.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["sessionSource"], "isolated_qrcode")

    def test_deprecated_browser_import_stays_disabled_and_fallback_is_explicit(self):
        result = subprocess.run(
            [str(XHS), "login", "--browser"], cwd=ROOT, env=self.env,
            text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Chrome session import is disabled", result.stdout)
        source = AUTH.read_text(encoding="utf-8")
        capture_source = CAPTURE.read_text(encoding="utf-8")
        for forbidden in ("Google/Chrome", "chrome_root", "cookie_file = chrome_root"):
            self.assertNotIn(forbidden, source)
        self.assertIn('CAIGUANG_CHROME_FALLBACK', source)
        self.assertIn('if os.environ.get("CAIGUANG_CHROME_FALLBACK", "0") != "1"', source)
        self.assertNotIn('parser.add_argument("--cookie"', capture_source)
        self.assertNotIn('command.extend(["--cookie"', capture_source)

    def test_logout_only_removes_isolated_config_files(self):
        cookie_file = self.config / "cookies.json"
        token_file = self.config / "token_cache.json"
        cookie_file.write_text(json.dumps({"sessionSource": "isolated_qrcode", "cookies": {"a1": "a", "web_session": "s"}}), encoding="utf-8")
        token_file.write_text("{}", encoding="utf-8")
        result = subprocess.run([str(XHS), "logout"], cwd=ROOT, env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(cookie_file.exists())
        self.assertFalse(token_file.exists())


if __name__ == "__main__":
    unittest.main()
