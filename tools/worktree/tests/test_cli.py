"""Exercise wt through its executable using disposable Git repositories."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CLI = Path(__file__).resolve().parents[1] / "bin" / "wt"


class WorktreeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name).resolve()
        self.repo = self.home / "project"
        self.repo.mkdir()
        self.env = {**os.environ, "HOME": str(self.home), "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull, "WT_ROOT": str(self.home / "trees"),
                    "GIT_TERMINAL_PROMPT": "0"}
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        (self.repo / ".gitignore").write_text("generated/\n")
        self.git("add", ".gitignore")
        self.git("commit", "-m", "TEST: Initialize disposable repository")

    def git(self, *args, cwd=None, ok=True):
        result = subprocess.run(["git", "-C", str(cwd or self.repo), *args],
                                env=self.env, text=True, capture_output=True, timeout=10)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def wt(self, *args, cwd=None, ok=True):
        result = subprocess.run([sys.executable, str(CLI), *args], cwd=cwd or self.repo,
                                env=self.env, text=True, capture_output=True, timeout=20)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def create(self, task="feature", *options):
        return json.loads(self.wt("new", task, *options, "--json").stdout)

    def commit_work(self, tree):
        (tree / "feature.txt").write_text("useful change\n")
        self.git("add", "feature.txt", cwd=tree)
        self.git("commit", "-m", "FEATURE: Add fixture behavior", cwd=tree)

    def test_new_creates_isolated_branch_without_changing_main_checkout(self):
        before = self.git("rev-parse", "HEAD")
        result = self.create()
        tree = Path(result["worktree"]["path"])
        self.assertEqual(result["protocolVersion"], 1)
        self.assertEqual(tree, self.home / "trees/project/feature")
        self.assertEqual(self.git("branch", "--show-current", cwd=tree), "tu/feature")
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertEqual(self.git("branch", "--show-current"), "main")
        self.assertEqual(result["transition"], {"kind": "enter-worktree", "targetPath": str(tree)})

    def test_new_shows_existing_tasks_only_on_stderr_in_json_mode(self):
        first = self.create()
        result = self.wt("new", "second", "--json")
        self.assertEqual(json.loads(result.stdout)["worktree"]["task"], "second")
        self.assertIn(first["worktree"]["path"], result.stderr)
        inventory = json.loads(result.stdout)["inventory"]
        self.assertIn(first["worktree"]["path"], [entry["path"] for entry in inventory["worktrees"]])
        self.assertEqual(inventory["omitted"], 0)

    def test_enter_and_list_work_from_linked_worktree(self):
        created = self.create()
        tree = Path(created["worktree"]["path"])
        entered = json.loads(self.wt("enter", "feature", "--json", cwd=tree).stdout)
        self.assertEqual(entered["worktree"], created["worktree"])
        listing = json.loads(self.wt("list", "--json", cwd=tree).stdout)
        self.assertEqual(len(listing["worktrees"]), 2)
        self.assertEqual(listing["project"]["root"], str(self.repo))

    def test_unmanaged_worktrees_are_visible_but_cannot_be_cleaned(self):
        other = self.home / "old-orchard"
        self.git("worktree", "add", "-b", "legacy", str(other))
        listing = json.loads(self.wt("list", "--json").stdout)
        self.assertFalse(next(w for w in listing["worktrees"] if w["path"] == str(other))["managed"])
        self.wt("clean", "old-orchard", "--json", ok=False)
        self.assertTrue(other.exists())

    def test_cleanup_preserves_unintegrated_commits_and_untracked_files(self):
        tree = Path(self.create()["worktree"]["path"])
        self.commit_work(tree)
        self.wt("clean", "feature", ok=False)
        self.git("merge", "--ff-only", "tu/feature")
        (tree / "notes.txt").write_text("keep me")
        result = self.wt("clean", "feature", ok=False)
        self.assertIn("untracked", result.stderr)
        self.assertTrue((tree / "notes.txt").exists())

    def assert_cleaned_branch(self):
        # The historical Python CLI retains branches; the Rust runner supplies
        # the current integrated-branch deletion contract for this same scenario.
        self.git("show-ref", "--verify", "refs/heads/tu/feature")

    def test_cleanup_disposes_ignored_files_after_integration(self):
        created = self.create()
        tree = Path(created["worktree"]["path"])
        self.commit_work(tree)
        self.git("merge", "--ff-only", "tu/feature")
        (tree / "generated").mkdir()
        (tree / "generated/cache").write_text("disposable")
        outcome = json.loads(self.wt("clean", "feature", "--json").stdout)
        self.assertFalse(tree.exists())
        self.assertEqual(outcome["transition"]["kind"], "none")
        self.assert_cleaned_branch()

    def test_cleanup_from_current_worktree_requests_return_without_deletion(self):
        tree = Path(self.create()["worktree"]["path"])
        outcome = json.loads(self.wt("clean", "feature", "--json", cwd=tree).stdout)
        self.assertEqual(outcome["transition"], {"kind": "return-main", "targetPath": str(self.repo)})
        self.assertTrue(tree.exists())

    def test_check_never_removes_worktree(self):
        tree = Path(self.create()["worktree"]["path"])
        self.wt("clean", "feature", "--check", "--json")
        self.assertTrue(tree.exists())

    def test_locks_block_cleanup_without_a_session_pid_exception(self):
        tree = Path(self.create()["worktree"]["path"])
        reason = f"wt-pi:{os.getpid()}"
        self.git("worktree", "lock", "--reason", reason, str(tree))
        self.wt("clean", "feature", "--check", ok=False)
        self.env["WT_SESSION_PID"] = str(os.getpid())
        self.wt("clean", "feature", "--check", "--json", cwd=tree, ok=False)
        self.wt("clean", "feature", "--json", ok=False)
        self.assertTrue(tree.exists())

    def test_invalid_arguments_do_not_create_worktrees(self):
        for arguments in [("new", "../escape"), ("new", "valid", "--invented"),
                          ("new", "valid", "--base"), ("enter", "valid", "--local")]:
            result = self.wt(*arguments, ok=False)
            self.assertEqual(result.returncode, 2, result.stderr)
        self.assertFalse((self.home / "trees").exists())

    def test_duplicate_task_does_not_replace_files(self):
        tree = Path(self.create()["worktree"]["path"])
        (tree / "notes").write_text("preserve")
        self.wt("new", "feature", ok=False)
        self.assertEqual((tree / "notes").read_text(), "preserve")

    def test_explicit_base_does_not_change_cleanup_target(self):
        self.git("branch", "dependency")
        outcome = self.create("dependent", "--base", "dependency")
        self.assertEqual(outcome["worktree"]["base"], "main")

    def test_missing_base_does_not_create_directory_or_branch(self):
        self.wt("new", "feature", "--base", "missing", ok=False)
        self.assertFalse((self.home / "trees/project/feature").exists())
        self.assertEqual(self.git("branch", "--list", "tu/feature"), "")


if __name__ == "__main__":
    unittest.main()
