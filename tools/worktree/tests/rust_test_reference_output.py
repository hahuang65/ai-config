"""The Python parity oracle must preserve Unix path bytes even on strict stdout."""
import os
from pathlib import Path
import subprocess
import sys
import unittest


class ReferenceOutputTest(unittest.TestCase):
    def test_plain_path_output_preserves_surrogateescaped_bytes(self):
        # Stub repository lookup, not output: APFS cannot create this Unix path.
        script = r'''
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from wt import cli
cli.Repository = lambda _: SimpleNamespace(common=Path("/unused"))
cli.repository_lock = lambda _: nullcontext()
cli.lifecycle.enter = lambda *_: {"command": "enter", "worktree": {"path": "/tmp/tree-\udcff"}}
raise SystemExit(cli.main(["enter", "feature"]))
'''
        result = subprocess.run(
            [sys.executable, "-c", script], capture_output=True, timeout=10,
            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
                 "PYTHONIOENCODING": "utf-8:strict"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b"/tmp/tree-\xff\n")
        self.assertEqual(result.stderr, b"")
