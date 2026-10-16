"""Ownership remains usable when the main checkout has a non-UTF-8 ancestor."""
import errno
import json
import os
from pathlib import Path
import sys

from rust_support import RustFixture


class OwnershipBytesTest(RustFixture):
    def test_created_worktrees_remain_manageable_beneath_a_non_utf8_parent(self):
        parent = self.home / os.fsdecode(b"parent-\xff")
        try:
            parent.mkdir()
        except OSError as error:
            if sys.platform == "darwin" and error.errno == errno.EILSEQ:
                self.skipTest(
                    "Darwin filesystem rejects non-UTF-8 parents (EILSEQ); "
                    "process lifecycle cannot run here. Both ownership readers "
                    "are covered by cargo test --bin wt ownership_bytes."
                )
            raise
        self.repo = self.repo.rename(parent / "project")
        created = self.create()
        tree = Path(created["worktree"]["path"])
        owner = tree.parent / ".repository"
        self.assertEqual(owner.read_bytes(), os.fsencode(self.repo / ".git") + b"\n")
        for cwd in (self.repo, tree):
            listing = json.loads(self.wt("list", "--json", cwd=cwd).stdout)
            entry = next(entry for entry in listing["worktrees"] if entry["path"] == str(tree))
            self.assertTrue(entry["managed"])
            entered = json.loads(self.wt("enter", "feature", "--json", cwd=cwd).stdout)
            self.assertEqual(entered["worktree"], created["worktree"])
            self.wt("clean", "feature", "--check", "--json", cwd=cwd)
            self.assertTrue(tree.is_dir())
        second = Path(self.create("second")["worktree"]["path"])
        for task, path in (("feature", tree), ("second", second)):
            self.wt("clean", task, "--json")
            self.assertFalse(path.exists())
            self.assertEqual(self.git("branch", "--list", f"tu/{task}"), "")
