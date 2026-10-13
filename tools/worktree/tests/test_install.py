"""Installation owns only its exact symlink, never an existing tool."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class InstallTest(unittest.TestCase):
    def test_install_repeat_launch_and_uninstall_leave_unrelated_files_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            environment = {**os.environ, "HOME": str(home)}
            target = home / ".local/bin/wt"
            for _ in range(2):
                result = subprocess.run([sys.executable, str(ROOT / "install.py")], env=environment,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(target.readlink(), ROOT / "bin/wt")
            result = subprocess.run([str(target), "--help"], env=environment,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Create, resume", result.stdout)
            result = subprocess.run([sys.executable, str(ROOT / "install.py"), "--uninstall"],
                                    env=environment, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(target.is_symlink())
            target.write_text("another tool")
            for option in ([], ["--uninstall"]):
                result = subprocess.run([sys.executable, str(ROOT / "install.py"), *option],
                                        env=environment, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(target.read_text(), "another tool")


if __name__ == "__main__":
    unittest.main()
