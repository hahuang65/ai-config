"""WT returns to the checkout, not a submodule's administrative directory."""
import json
from pathlib import Path

from rust_support import RustFixture


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
        self.wt("clean", "feature", "--json", cwd=tree, ok=False)
        self.assertTrue(tree.is_dir())
        self.assertTrue(retained.is_dir())
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.parent), self.parent_head)

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
        returning = json.loads(self.wt("clean", "feature", "--json", cwd=tree).stdout)
        self.assertEqual(returning["transition"],
                         {"kind": "return-main", "targetPath": str(self.repo)})
        self.assertTrue(tree.is_dir())
        self.wt("clean", "feature", "--json")
        self.assertFalse(tree.exists())
        self.assertEqual(self.git("branch", "--list", "tu/feature"), "")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.parent), self.parent_head)
        self.assertEqual(self.git("status", "--porcelain", cwd=self.parent), "")
