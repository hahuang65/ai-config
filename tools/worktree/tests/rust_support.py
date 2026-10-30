"""Disposable process fixtures shared by the added Rust compatibility tests."""
import json
import os
from pathlib import Path
import subprocess
import sys

import test_remote

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("WT_RUST_BINARY", ROOT / "target/debug/wt")).resolve()


def current_cleanup_help(output):
    """Project only the deliberate Rust docs-preservation help change."""
    return output.replace(
        "Remove integrated, clean tasks; ignored files are\n                        disposable",
        "Remove integrated tasks; preserve private docs first")


class RustFixture(test_remote.GitFixture):
    def command(self, arguments, *, cwd=None, original=False, timeout=20):
        executable = [sys.executable, str(ROOT / "bin/wt")] if original else [str(BINARY)]
        return subprocess.run([*executable, *arguments], cwd=cwd or self.repo,
                              env=self.env, text=True, capture_output=True, timeout=timeout)

    def wt(self, *arguments, cwd=None, ok=True):
        result = self.command(arguments, cwd=cwd)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def assert_parity(self, *arguments, cwd=None):
        original = self.command(arguments, cwd=cwd, original=True)
        rust = self.command(arguments, cwd=cwd)
        self.assertEqual(rust.returncode, original.returncode)
        self.assertEqual(rust.stderr, current_cleanup_help(original.stderr))
        if "--json" in arguments and original.returncode == 0:
            self.assertEqual(json.loads(rust.stdout), json.loads(original.stdout))
        else:
            self.assertEqual(rust.stdout, current_cleanup_help(original.stdout))
        return rust

    def delivery(self, task):
        created = self.create(task, "--local")
        return json.loads(self.record_path(created["worktree"]["path"]).read_text())["delivery"]
