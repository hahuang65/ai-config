"""Remote and repository safety through disposable Git and the real WT executable."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import test_cli
from wt.repository import Repository, task_name


class GitFixture(unittest.TestCase):
    git = test_cli.WorktreeTest.git
    wt = test_cli.WorktreeTest.wt
    create = test_cli.WorktreeTest.create
    commit_work = test_cli.WorktreeTest.commit_work

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wt-safety-")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.repo = self.home / "project"
        self.repo.mkdir()
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("GIT_", "WT_", "GH_"))}
        self.env.update(HOME=str(self.home), GIT_CONFIG_NOSYSTEM="1",
                        GIT_CONFIG_GLOBAL=str(self.home / "global.gitconfig"),
                        WT_ROOT=str(self.home / "trees"), GIT_TERMINAL_PROMPT="0")
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("commit", "--allow-empty", "-m", "Initialize fixture")

    def record_path(self, tree):
        return Path(self.git("rev-parse", "--path-format=absolute", "--git-path", "wt.json", cwd=tree))

    def assert_no_task(self, task="feature"):
        self.assertFalse((self.home / "trees/project" / task).exists())
        self.assertEqual(self.git("branch", "--list", f"tu/{task}"), "")
        self.assertEqual(len(json.loads(self.wt("list", "--json").stdout)["worktrees"]), 1)


class RemoteCreationTest(GitFixture):
    def setUp(self):
        super().setUp()
        self.remote = self.home / "remote.git"
        self.git("init", "--bare", "-b", "primary", str(self.remote))
        self.git("branch", "-m", "primary")
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "-u", "origin", "primary")
        self.git("remote", "set-head", "origin", "-a")
        self.publisher = self.home / "publisher"
        self.git("clone", str(self.remote), str(self.publisher))
        for key, value in [("user.name", "Publisher"), ("user.email", "publish@example.invalid"),
                           ("commit.gpgsign", "false")]:
            self.git("config", key, value, cwd=self.publisher)

    def advance_remote(self):
        self.commit_work(self.publisher)
        self.git("push", "origin", "primary", cwd=self.publisher)
        return self.git("rev-parse", "HEAD", cwd=self.publisher)

    def test_new_fetches_newer_default_without_changing_primary_checkout(self):
        before = self.git("rev-parse", "HEAD")
        self.git("switch", "-c", "unrelated")
        (self.repo / "notes").write_text("Do not touch 雪 🐍 ' ;\n")
        latest = self.advance_remote()
        created = self.create()
        tree = Path(created["worktree"]["path"])
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=tree), latest)
        self.assertEqual(created["worktree"]["base"], "primary")
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertEqual(self.git("rev-parse", "primary"), before)
        self.assertEqual(self.git("branch", "--show-current"), "unrelated")
        self.assertEqual((self.repo / "notes").read_text(), "Do not touch 雪 🐍 ' ;\n")

    def test_local_ahead_history_is_preserved(self):
        self.commit_work(self.repo)
        ahead = self.git("rev-parse", "HEAD")
        tree = Path(self.create()["worktree"]["path"])
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=tree), ahead)
        self.assertEqual(self.git("rev-parse", "primary"), ahead)

    def test_divergence_refuses_creation_unless_base_is_explicit(self):
        self.commit_work(self.repo)
        ahead = self.git("rev-parse", "HEAD")
        remote = self.advance_remote()
        self.assertNotEqual(ahead, remote)
        refused = self.wt("new", "feature", ok=False)
        self.assertIn("diverged", refused.stderr)
        self.assert_no_task()
        created = self.create("feature", "--base", "origin/primary")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=created["worktree"]["path"]), remote)
        self.assertEqual(self.git("rev-parse", "primary"), ahead)
        self.assertEqual(created["worktree"]["base"], "primary")

    def test_failed_fetch_creates_nothing_even_with_base_but_local_is_explicit_escape(self):
        self.git("remote", "set-url", "origin", str(self.home / "missing.git"))
        for options in [(), ("--base", "primary")]:
            with self.subTest(options=options):
                self.assertIn("fetch", self.wt("new", "feature", *options, ok=False).stderr)
                self.assert_no_task()
        created = self.create("feature", "--local")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=created["worktree"]["path"]),
                         self.git("rev-parse", "primary"))

    def test_remote_only_default_branch_can_supply_starting_commit(self):
        latest = self.advance_remote()
        self.git("switch", "-c", "unrelated")
        self.git("branch", "-D", "primary")
        created = self.create()
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=created["worktree"]["path"]), latest)
        self.assertEqual(self.git("branch", "--list", "primary"), "")

    def test_configured_remote_and_base_override_default(self):
        self.git("branch", "release")
        self.git("push", "origin", "release")
        self.git("remote", "rename", "origin", "upstream")
        self.git("remote", "add", "other", str(self.home / "missing.git"))
        self.git("config", "wt.remote", "upstream")
        self.git("config", "wt.base", "release")
        created = self.create()
        record = json.loads(self.record_path(created["worktree"]["path"]).read_text())
        self.assertEqual((record["remote"], record["base"]), ("upstream", "release"))

    def test_local_mode_cannot_use_remote_only_history(self):
        self.git("switch", "-c", "unrelated")
        self.git("branch", "-D", "primary")
        self.wt("new", "feature", "--local", ok=False)
        self.assert_no_task()

    def test_single_non_origin_remote_is_selected_without_configuration(self):
        self.git("remote", "rename", "origin", "upstream")
        latest = self.advance_remote()
        created = self.create()
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=created["worktree"]["path"]), latest)

    def test_missing_remote_default_refuses_without_guessing_main(self):
        self.git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD")
        result = self.wt("new", "feature", ok=False)
        self.assertIn("default branch is unknown", result.stderr)
        self.assertFalse((self.home / "trees").exists())


class RepositorySafetyTest(GitFixture):
    def test_invalid_repository_settings_fail_before_creating_worktrees(self):
        for key, value in [("wt.project", "../outside"), ("wt.base", "main~0"),
                           ("wt.remote", "missing")]:
            with self.subTest(key=key):
                self.git("config", key, value)
                self.wt("new", "feature", ok=False)
                self.assertFalse((self.home / "trees").exists())
                self.assertEqual(self.git("branch", "--list", "tu/feature"), "")
                self.git("config", "--unset", key)

    def test_multiple_remotes_without_origin_require_explicit_selection(self):
        for name in ("first", "second"):
            self.git("remote", "add", name, str(self.home / name))
        self.assertIn("Several remotes", self.wt("new", "feature", ok=False).stderr)
        self.assertFalse((self.home / "trees").exists())

    def test_ambiguous_local_base_requires_configuration(self):
        self.git("branch", "master")
        self.assertIn("wt.base", self.wt("new", "feature", ok=False).stderr)
        self.assertFalse((self.home / "trees").exists())
        self.git("config", "wt.base", "master")
        self.assertEqual(self.create()["worktree"]["base"], "master")

    def test_symlink_worktree_root_does_not_write_outside_the_managed_root(self):
        outside = self.home / "outside"
        outside.mkdir()
        (self.home / "trees").symlink_to(outside, target_is_directory=True)
        self.wt("new", "feature", ok=False)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(self.git("branch", "--list", "tu/feature"), "")

    def test_missing_or_changed_ownership_record_prevents_cleanup(self):
        tree = Path(self.create()["worktree"]["path"])
        owner = tree.parent / ".repository"
        owner.unlink()
        self.wt("clean", "feature", ok=False)
        owner.write_text("another repository")
        self.wt("clean", "feature", ok=False)
        self.assertTrue(tree.is_dir())

    def test_existing_branch_collision_never_resets_branch(self):
        self.git("branch", "tu/feature")
        before = self.git("rev-parse", "tu/feature")
        self.wt("new", "feature", ok=False)
        self.assertEqual(self.git("rev-parse", "tu/feature"), before)
        self.assertFalse((self.home / "trees").exists())

    def test_existing_directory_and_dangling_symlink_are_not_replaced(self):
        target = self.home / "trees/project/feature"
        target.mkdir(parents=True)
        marker = target / "keep"
        marker.write_text("preserve")
        self.wt("new", "feature", ok=False)
        self.assertEqual(marker.read_text(), "preserve")
        marker.unlink()
        target.rmdir()
        target.symlink_to(self.home / "missing")
        self.wt("new", "feature", ok=False)
        self.assertTrue(target.is_symlink())
        self.assertEqual(self.git("branch", "--list", "tu/feature"), "")

    def test_another_repository_owner_or_owner_symlink_blocks_claim(self):
        directory = self.home / "trees/project"
        directory.mkdir(parents=True)
        owner = directory / ".repository"
        owner.write_text("/another/repository/.git\n")
        self.wt("new", "feature", ok=False)
        self.assert_no_task()
        self.assertEqual(owner.read_text(), "/another/repository/.git\n")
        owner.unlink()
        outside = self.home / "owner"
        outside.write_text(str(self.repo / ".git") + "\n")
        owner.symlink_to(outside)
        self.wt("new", "feature", ok=False)
        self.assert_no_task()
        self.assertTrue(owner.is_symlink())

    def test_symlink_project_directory_cannot_claim_external_directory(self):
        root = self.home / "trees"
        root.mkdir()
        outside = self.home / "outside"
        outside.mkdir()
        (root / "project").symlink_to(outside, target_is_directory=True)
        self.wt("new", "feature", ok=False)
        self.assertEqual(list(outside.iterdir()), [])
        self.assert_no_task()

    def test_invalid_metadata_is_unmanaged_and_cannot_be_removed(self):
        tree = Path(self.create()["worktree"]["path"])
        record = self.record_path(tree)
        original = json.loads(record.read_text())
        mutations = [None, [], "", 42, {**original, "version": True},
                     {**original, "path": str(self.repo)}, {**original, "task": "other"},
                     {**original, "branch": "main~0"}, {**original, "base": "main~0"},
                     {**original, "base": ""}, {**original, "remote": []},
                     {**original, "delivery": "unknown"}, {**original, "extra": True}]
        for mutation in mutations:
            with self.subTest(record=mutation):
                record.write_text(json.dumps(mutation))
                listing = json.loads(self.wt("list", "--json").stdout)
                self.assertFalse(next(w for w in listing["worktrees"] if w["path"] == str(tree))["managed"])
                self.wt("clean", "feature", ok=False)
                self.assertTrue(tree.is_dir())

    def test_missing_corrupt_or_symlink_metadata_is_not_trusted(self):
        tree = Path(self.create()["worktree"]["path"])
        record = self.record_path(tree)
        original = record.read_text()
        record.unlink()
        self.wt("clean", "feature", ok=False)
        record.write_text("{broken")
        self.wt("clean", "feature", ok=False)
        record.unlink()
        outside = self.home / "record.json"
        outside.write_text(original)
        record.symlink_to(outside)
        self.wt("clean", "feature", ok=False)
        self.assertTrue(tree.is_dir())
        self.assertEqual(outside.read_text(), original)

    def test_changed_branch_is_preserved(self):
        tree = Path(self.create()["worktree"]["path"])
        self.git("switch", "-c", "other", cwd=tree)
        result = self.wt("clean", "feature", ok=False)
        self.assertIn("branch changed", result.stderr)
        self.assertTrue(tree.is_dir())

    def test_simultaneous_creations_never_replace_the_winner(self):
        arguments = [sys.executable, str(test_cli.CLI), "new", "feature", "--json"]
        processes = [subprocess.Popen(arguments, cwd=self.repo, env=self.env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                     for _ in range(2)]
        for process in processes:
            self.addCleanup(lambda p=process: p.poll() is None and p.kill())
        outputs = [process.communicate(timeout=20) for process in processes]
        self.assertEqual(sorted(process.returncode for process in processes), [0, 1])
        winner = next(json.loads(stdout) for process, (stdout, _) in zip(processes, outputs)
                      if process.returncode == 0)
        self.assertTrue(Path(winner["worktree"]["path"]).is_dir())
        self.assertEqual(len(json.loads(self.wt("list", "--json").stdout)["worktrees"]), 2)

    def test_delivery_defaults_local_and_repository_family_cannot_enable_github(self):
        self.git("config", "ai.projectFamily", "a5")
        with patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(Repository(self.repo).delivery(), "local")

    def test_effective_global_or_system_family_controls_default_delivery(self):
        system = self.home / "system.gitconfig"
        self.env.pop("GIT_CONFIG_NOSYSTEM")
        self.env["GIT_CONFIG_SYSTEM"] = str(system)
        self.git("config", "--system", "ai.projectFamily", "a5")
        for global_value, expected in [(None, "github"), ("other", "local"),
                                       ("", "local"), ("a5", "github")]:
            with self.subTest(global_value=global_value):
                if global_value is not None:
                    self.git("config", "--global", "ai.projectFamily", global_value)
                with patch.dict(os.environ, self.env, clear=True):
                    self.assertEqual(Repository(self.repo).delivery(), expected)

    def test_global_conditional_include_controls_delivery_in_this_repository(self):
        included = self.home / "family.gitconfig"
        self.git("config", "--file", str(included), "ai.projectFamily", "a5")
        self.git("config", "--global", f"includeIf.gitdir:{self.repo}/.git.path", str(included))
        self.git("config", "ai.projectFamily", "not-a5")
        with patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(Repository(self.repo).delivery(), "github")

    def test_explicit_delivery_overrides_family_and_invalid_value_refuses_creation(self):
        self.git("config", "--global", "ai.projectFamily", "a5")
        for value in ("local", "github"):
            self.git("config", "wt.delivery", value)
            with patch.dict(os.environ, self.env, clear=True):
                self.assertEqual(Repository(self.repo).delivery(), value)
        self.git("config", "wt.delivery", "unknown")
        self.wt("new", "feature", ok=False)
        self.assert_no_task()


class TaskNameTest(unittest.TestCase):
    def test_valid_names_include_boundary_lengths(self):
        for value in ("a", "a" * 64, "Task_123-xyz"):
            self.assertEqual(task_name(value), value)

    def test_invalid_names_and_types_raise_value_error(self):
        for value in (None, 0, [], {}, "", "a" * 65, "../escape", "-option", "雪", "🐍", "a\n", "x';"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                task_name(value)


if __name__ == "__main__":
    unittest.main()
