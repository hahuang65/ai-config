"""WT returns to the checkout, not a submodule's administrative directory."""
import json
from pathlib import Path
import subprocess

from rust_support import BINARY, RustFixture


class SubmoduleCheckoutTest(RustFixture):
    def setUp(self):
        super().setUp()
        self.parent = self.home / ".dotfiles"
        self.parent.mkdir()
        self.git("init", "-b", "main", cwd=self.parent)
        for key, value in (("user.name", "Test User"), ("user.email", "test@example.invalid"),
                           ("commit.gpgsign", "false")):
            self.git("config", key, value, cwd=self.parent)
        self.git("-c", "protocol.file.allow=always", "submodule", "add", "--name",
                 "stored-module", str(self.repo), "component", cwd=self.parent)
        self.git("commit", "-am", "TEST: Add disposable submodule", cwd=self.parent)
        self.repo = self.parent / "component"
        self.git("config", "wt.initials", "tu")
        self.parent_head = self.git("rev-parse", "HEAD", cwd=self.parent)

    def test_missing_main_submodule_checkout_is_not_replaced_by_the_current_task(self):
        created = self.create("feature", "--local")
        tree = Path(created["worktree"]["path"])
        retained = self.parent / "retained-component"
        self.repo.rename(retained)
        self.wt("list", "--json", cwd=tree, ok=False)
        self.wt("leave", "--json", cwd=tree, ok=False)
        self.wt("clean", "feature", "--json", cwd=tree, ok=False)
        self.assertTrue(tree.is_dir())
        self.assertTrue(retained.is_dir())
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.parent), self.parent_head)

    def test_leave_preserves_whitespace_in_submodule_primary_paths(self):
        setup = self.home / "integration.bash"
        setup.write_text(self.wt("shell-init", "bash").stdout)
        for index, suffix in enumerate(("\n\n", " \t", "\r\n")):
            with self.subTest(suffix=repr(suffix)):
                name = f"whitespace-{index}"
                primary = self.repo.with_name(self.repo.name + suffix)
                self.git("-c", "protocol.file.allow=always", "submodule", "add",
                         "--name", name, str(self.repo), primary.name, cwd=self.parent)
                self.git("config", "wt.project", name, cwd=primary)
                task = self.home / name
                self.git("worktree", "add", "--detach", str(task), cwd=primary)
                result = json.loads(self.wt("leave", "--json", cwd=task).stdout)
                self.assertEqual(result["project"]["root"], str(primary))
                self.assertEqual(result["transition"],
                                 {"kind": "return-main", "targetPath": str(primary)})
                output = subprocess.run(
                    ["bash", "--noprofile", "--norc", "-c",
                     'source "$1"; _wt_shell "$2" leave || exit; '
                     'builtin printf "%s\\0" "$PWD"',
                     "wt-submodule", str(setup), str(BINARY)],
                    cwd=task, env=self.env, capture_output=True, timeout=20)
                self.assertEqual(output.returncode, 0, output.stderr)
                self.assertEqual(output.stdout, str(primary).encode() + b"\0")
                self.assertEqual(output.stderr, b"")
                self.assertTrue(task.is_dir())
                self.assertTrue(self.repo.is_dir())
                self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.parent),
                                 self.parent_head)

    def test_submodule_tasks_list_enter_and_return_to_the_real_main_checkout(self):
        listing = json.loads(self.wt("list", "--json").stdout)
        self.assertEqual(listing["project"]["root"], str(self.repo))
        self.assertEqual(listing["worktrees"][0]["path"], str(self.repo))
        self.assertFalse(listing["worktrees"][0]["managed"])
        created = self.create("feature", "--local")
        tree = Path(created["worktree"]["path"])
        self.assertEqual(tree, self.home / "trees/component/feature")
        listing = json.loads(self.wt("list", "--json", cwd=tree).stdout)
        self.assertEqual(listing["project"]["root"], str(self.repo))
        self.assertEqual(listing["worktrees"][0]["path"], str(self.repo))
        entered = json.loads(self.wt("enter", "feature", "--json", cwd=tree).stdout)
        self.assertEqual(entered["worktree"], created["worktree"])
        left = json.loads(self.wt("leave", "--json", cwd=tree).stdout)
        self.assertEqual(left["transition"],
                         {"kind": "return-main", "targetPath": str(self.repo)})
        returning = json.loads(self.wt("clean", "feature", "--json", cwd=tree).stdout)
        self.assertEqual(returning["transition"],
                         {"kind": "return-main", "targetPath": str(self.repo)})
        self.assertTrue(tree.is_dir())
        self.wt("clean", "feature", "--json")
        self.assertFalse(tree.exists())
        self.assertEqual(self.git("branch", "--list", "tu/feature"), "")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.parent), self.parent_head)
        self.assertEqual(self.git("status", "--porcelain", cwd=self.parent), "")
