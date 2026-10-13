"""Rust process coverage for Python-only policies and additional safety boundaries."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from rust_support import BINARY, RustFixture


class DeliveryPolicyTest(RustFixture):
    def test_repository_local_family_cannot_enable_github_delivery(self):
        self.git("config", "ai.projectFamily", "a5")
        self.assertEqual(self.delivery("local-only"), "local")

    def test_effective_system_and_global_family_select_delivery(self):
        self.env.pop("GIT_CONFIG_NOSYSTEM")
        self.env["GIT_CONFIG_SYSTEM"] = str(self.home / "system.gitconfig")
        self.git("config", "--system", "ai.projectFamily", "a5")
        self.assertEqual(self.delivery("system"), "github")
        for index, value in enumerate(("other", "", "a5")):
            with self.subTest(value=value):
                self.git("config", "--global", "ai.projectFamily", value)
                self.assertEqual(self.delivery(f"global-{index}"), "github" if value == "a5" else "local")

    def test_global_conditional_include_controls_delivery(self):
        included = self.home / "family.gitconfig"
        self.git("config", "--file", str(included), "ai.projectFamily", "a5")
        self.git("config", "--global", f"includeIf.gitdir:{self.repo}/.git.path", str(included))
        self.git("config", "ai.projectFamily", "not-a5")
        self.assertEqual(self.delivery("conditional"), "github")

    def test_explicit_delivery_overrides_family_and_rejects_unknown_values(self):
        self.git("config", "--global", "ai.projectFamily", "a5")
        for value in ("local", "github"):
            self.git("config", "wt.delivery", value)
            self.assertEqual(self.delivery(value), value)
        self.git("config", "wt.delivery", "unknown")
        self.assert_parity("new", "invalid", "--local")
        self.assertFalse((self.home / "trees/project/invalid").exists())
        self.assertEqual(self.git("branch", "--list", "tu/invalid"), "")


class AdditionalSafetyTest(RustFixture):
    def test_operation_lock_blocks_every_command_and_releases_after_exit(self):
        with (self.repo / ".git/wt-operation.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for command in (("new", "feature"), ("enter", "feature"), ("list",), ("clean",)):
                with self.subTest(command=command):
                    self.assertIn("Another wt operation", self.assert_parity(*command).stderr)
        self.create()
        self.assert_parity("list", "--json")

    def test_operation_lock_symlink_never_overwrites_its_target(self):
        outside = self.home / "untouched"
        outside.write_text("keep")
        (self.repo / ".git/wt-operation.lock").symlink_to(outside)
        self.wt("new", "feature", ok=False)
        self.assertEqual(outside.read_text(), "keep")
        self.assertFalse((self.home / "trees").exists())

    def test_git_in_progress_markers_block_cleanup_even_with_a_clean_index(self):
        tree = Path(self.create()["worktree"]["path"])
        for marker in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"):
            with self.subTest(marker=marker):
                path = Path(self.git("rev-parse", "--path-format=absolute", "--git-path", marker, cwd=tree))
                path.write_text("")
                self.assertIn("operation is still in progress", self.assert_parity("clean", "feature", "--check").stderr)
                path.unlink()
        self.assertTrue(tree.is_dir())

    def test_foreign_dead_and_overflow_session_owners_cannot_bypass_locks(self):
        tree = Path(self.create()["worktree"]["path"])
        for owner in ("not-a-pid", "9" * 100, str(os.getpid())):
            with self.subTest(owner=owner):
                self.git("worktree", "lock", "--reason", "wt-pi:2147483647", str(tree))
                self.env["WT_SESSION_PID"] = owner
                self.assertIn("locked", self.assert_parity("clean", "feature", "--check", cwd=tree).stderr)
                self.git("worktree", "unlock", str(tree))
        self.assertTrue(tree.exists())

    def test_inherited_git_directory_overrides_do_not_redirect_operations(self):
        self.env.update(GIT_DIR=str(self.home / "missing"), GIT_WORK_TREE=str(self.home),
                        GIT_INDEX_FILE=str(self.home / "foreign-index"))
        self.assert_parity("list", "--json")
        self.assertFalse((self.home / "foreign-index").exists())

    def test_dotfiles_parent_and_bare_repositories_refuse_creation(self):
        self.repo.rename(self.home / ".dotfiles")
        self.repo = self.home / ".dotfiles"
        self.assertIn("dotfiles parent", self.assert_parity("new", "feature").stderr)
        bare = self.home / "bare.git"
        self.git("init", "--bare", str(bare))
        self.assertIn("non-bare", self.assert_parity("new", "feature", cwd=bare).stderr)
        self.assertFalse((self.home / "trees").exists())

    def test_symlink_ancestor_of_worktree_root_cannot_claim_external_directory(self):
        outside = self.home / "outside"
        outside.mkdir()
        redirect = self.home / "redirect"
        redirect.symlink_to(outside, target_is_directory=True)
        self.env["WT_ROOT"] = str(redirect / "nested")
        self.assertIn("canonical", self.assert_parity("new", "feature").stderr)
        self.assertEqual(list(outside.iterdir()), [])

    def test_interrupt_stops_a_provider_call_without_removal_or_lock_leak(self):
        tree = Path(self.create()["worktree"]["path"])
        record = self.record_path(tree)
        metadata = json.loads(record.read_text())
        metadata.update(delivery="github", remote="origin")
        record.write_text(json.dumps(metadata))
        self.git("remote", "add", "origin", "https://github.com/example/project")
        self.git("config", "wt.base", "main")
        executables = self.home / "bin"
        executables.mkdir()
        started = self.home / "started"
        provider = executables / "gh"
        provider.write_text(f"#!{sys.executable}\nimport pathlib, time\npathlib.Path({str(started)!r}).touch()\ntime.sleep(60)\n")
        provider.chmod(0o700)
        self.env["PATH"] = str(executables) + os.pathsep + self.env["PATH"]
        process = subprocess.Popen([str(BINARY), "clean", "feature"], cwd=self.repo,
                                   env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        deadline = time.monotonic() + 10
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists(), "fake provider did not start")
        process.send_signal(signal.SIGINT)
        stdout, stderr = process.communicate(timeout=5)
        self.assertEqual((process.returncode, stdout), (130, ""))
        self.assertIn("no automatic rollback", stderr)
        self.assertTrue(tree.is_dir())
        self.wt("list", "--json")
