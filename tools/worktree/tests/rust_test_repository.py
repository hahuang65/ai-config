"""Verify pristine fixture reuse without sharing writable repository state."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from repository_fixture import MAX_BYTES, MAX_ENTRIES, RepositorySeeds

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_GUARD_SECONDS = 20
GIT_GUARD_SECONDS = 10


class RepositoryFixtureTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wt-seed-test-")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        self.env.update(HOME=str(self.home), GIT_CONFIG_NOSYSTEM="1",
                        GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0")
        self.seeds = RepositorySeeds()

    def git(self, root, *args, ok=True):
        result = subprocess.run(["git", "-C", str(root), *args], env=self.env,
                                capture_output=True, text=True, timeout=GIT_GUARD_SECONDS)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stderr)
        return result.stdout.strip()

    def repository(self, name, ignored=False):
        root = self.home / name
        root.mkdir()
        self.seeds.prepare(root, lambda *args: self.git(root, *args), ignored=ignored)
        return root

    def test_fixture_shapes_initialize_once_per_process_without_persistent_reuse(self):
        for _ in range(2):
            result = subprocess.run([sys.executable, "-c", SEED_COUNTS], cwd=ROOT,
                                    capture_output=True, text=True,
                                    timeout=FIXTURE_GUARD_SECONDS)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {"WorktreeTest": 1, "GitFixture": 1})

    def test_copies_preserve_bytes_and_modes_without_sharing_writable_state(self):
        for ignored in (False, True):
            with self.subTest(ignored=ignored):
                first = self.repository(f"first-{ignored}", ignored)
                second = self.repository(f"second-{ignored}", ignored)
                objects = [path for path in (first / ".git/objects").rglob("*") if path.is_file()]
                paths = [Path(".git/config"), Path(".git/refs/heads/main"),
                         objects[0].relative_to(first)]
                expected = {path: ((first / path).read_bytes(),
                                  stat.S_IMODE((first / path).stat().st_mode)) for path in paths}
                for path in paths:
                    self.assertNotEqual((first / path).stat().st_ino, (second / path).stat().st_ino)
                    (first / path).chmod(0o600)
                    (first / path).write_bytes(b"corrupted only in first fixture\n")
                (first / "private-note").write_text("private\n")
                third = self.repository(f"third-{ignored}", ignored)
                for root in (second, third):
                    for path, (contents, mode) in expected.items():
                        self.assertEqual((root / path).read_bytes(), contents)
                        self.assertEqual(stat.S_IMODE((root / path).stat().st_mode), mode)
                    self.assertFalse((root / "private-note").exists())
                    self.assertEqual(self.git(root, "status", "--porcelain"), "")
                    self.git(root, "fsck", "--strict")
                    self.assertEqual(self.git(root, "ls-files"), ".gitignore" if ignored else "")

    def test_seed_maintenance_settings_are_command_local_and_not_copied(self):
        with patch.object(self, "git", wraps=self.git) as commands:
            first = self.repository("first")
            second = self.repository("second")
        commits = [call.args[1:] for call in commands.call_args_list if "commit" in call.args]
        self.assertEqual(commits, [("-c", "maintenance.auto=false", "-c", "gc.auto=0",
                                   "commit", "--allow-empty", "-m", "Initialize fixture")])
        for root in (first, second):
            self.assertEqual(self.git(root, "config", "--local", "--get-regexp",
                                      "^(maintenance.auto|gc.auto)$", ok=False), "")

    def test_invalid_shapes_and_nonempty_destinations_do_not_write_or_run_git(self):
        root = self.home / "destination"
        root.mkdir()
        git = Mock()
        for invalid in (None, 1, "other"):
            with self.assertRaisesRegex(ValueError, "Unknown.*shape"):
                self.seeds.prepare(root, git, ignored=invalid)
        self.assertEqual(list(root.iterdir()), [])
        self.repository("seed")
        (root / "keep").write_text("unchanged")
        with self.assertRaisesRegex(ValueError, "start empty"):
            self.seeds.prepare(root, git)
        self.assertEqual((root / "keep").read_text(), "unchanged")
        self.assertEqual([path.name for path in root.iterdir()], ["keep"])
        git.assert_not_called()

    def test_unsafe_or_oversized_capture_fails_without_poisoning_later_fixtures(self):
        for kind, message in (("bytes", "too large"), ("entries", "too many entries"),
                              ("symlink", "non-regular"), ("lock", "active lock")):
            with self.subTest(kind=kind):
                self.seeds = RepositorySeeds()
                root = self.home / kind
                root.mkdir()
                def git(*args):
                    if args[0] == "init":
                        invalid_seed(root, kind)
                with self.assertRaisesRegex(ValueError, message):
                    self.seeds.prepare(root, git)
                clean = self.repository(f"recovery-{kind}")
                copied = self.repository(f"copied-{kind}")
                for repository in (clean, copied):
                    self.assertEqual(self.git(repository, "status", "--porcelain"), "")
                    self.git(repository, "fsck", "--strict")


def invalid_seed(root, kind):
    if kind == "bytes":
        (root / "oversized").write_bytes(b"x" * (MAX_BYTES + 1))
    elif kind == "entries":
        for index in range(MAX_ENTRIES + 1):
            (root / str(index)).touch()
    elif kind == "symlink":
        (root / "redirected").symlink_to(root.parent)
    else:
        lock = root / ".git/objects/maintenance.lock"
        lock.parent.mkdir(parents=True)
        lock.touch()


SEED_COUNTS = """
import json, subprocess, sys
from unittest.mock import patch
sys.path.insert(0, 'tests')
import test_cli, test_remote
counts = {}
for fixture in (test_cli.WorktreeTest, test_remote.GitFixture):
    instances = []
    try:
        with patch.object(subprocess, 'run', wraps=subprocess.run) as commands:
            for _ in range(3):
                instance = fixture()
                instances.append(instance)
                instance.setUp()
        counts[fixture.__name__] = sum('init' in call.args[0] for call in commands.call_args_list)
    finally:
        for instance in instances:
            instance.doCleanups()
print(json.dumps(counts))
"""
