"""Compare stable public output directly with the unchanged Python executable."""
import json
from pathlib import Path

from rust_support import RustFixture


class OutputParityTest(RustFixture):
    def test_help_and_invalid_argument_diagnostics_match(self):
        cases = [(), ("--help",), ("new", "--help"), ("enter", "--help"),
                 ("list", "--help"), ("clean", "--help"), ("unknown",),
                 ("new",), ("enter",), ("new", "../escape"),
                 ("new", "a" * 65), ("new", "雪"), ("new", "valid", "--invented"),
                 ("new", "valid", "--base"), ("enter", "valid", "--local"),
                 ("new", "valid", "--base=-option"), ("new", "valid", "--base", "main\n"),
                 ("list", "extra"), ("list", "--all=yes"), ("--json", "list"),
                 ("new", "valid", "--j"), ("clean", "--check=no"), ("list", "--json=false")]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                self.assert_parity(*arguments)
        self.assertFalse((self.home / "trees").exists())

    def test_task_name_boundaries_are_accepted_through_the_executable(self):
        for name in ("a", "a" * 64, "Task_123-xyz"):
            self.assertEqual(self.create(name)["worktree"]["task"], name)

    def test_readonly_text_and_json_match_from_main_and_linked_subdirectories(self):
        tree = Path(self.create()["worktree"]["path"])
        nested = tree / "nested"
        nested.mkdir()
        for cwd in (self.repo, tree, nested):
            for arguments in (("list",), ("list", "--all", "--json"), ("enter", "feature"),
                              ("enter", "feature", "--json"), ("clean", "feature", "--check"),
                              ("clean", "feature", "--check", "--json")):
                with self.subTest(cwd=cwd, arguments=arguments):
                    self.assert_parity(*arguments, cwd=cwd)

    def test_python_records_remain_usable_by_rust_and_rust_records_by_python(self):
        created = self.command(("new", "python-task", "--json"), original=True)
        self.assertEqual(created.returncode, 0, created.stderr)
        self.create("rust-task")
        self.assert_parity("list", "--json")
        self.assert_parity("enter", "python-task", "--json")
        self.assert_parity("clean", "--check", "--json")
        self.wt("clean", "python-task")
        original = self.command(("clean", "rust-task"), original=True)
        self.assertEqual(original.returncode, 0, original.stderr)

    def test_empty_and_check_outputs_match_and_cleanup_deletes_only_integrated_branches(self):
        self.assert_parity("clean")
        self.assert_parity("clean", "--json")
        good = Path(self.create("good")["worktree"]["path"])
        dirty = Path(self.create("dirty")["worktree"]["path"])
        (dirty / "notes").write_text("keep")
        self.assert_parity("clean", "--check")
        self.assert_parity("clean", "--check", "--json")
        result = json.loads(self.wt("clean", "--json", ok=False).stdout)
        self.assertEqual([item["removed"] for item in result["results"]], [False, True])
        self.assertFalse(good.exists())
        self.assertTrue(dirty.exists())
        self.assertEqual(self.git("branch", "--list", "tu/good"), "")
        self.git("show-ref", "--verify", "refs/heads/tu/dirty")

    def test_inventory_and_reminder_limits_match_the_full_list_escape(self):
        for index in range(51):
            self.git("worktree", "add", "--detach", str(self.home / f"unmanaged-{index:02}"))
        for arguments in (("list",), ("list", "--json"), ("list", "--all"), ("list", "--all", "--json")):
            self.assert_parity(*arguments)
        result = self.create()
        self.assertEqual((len(result["inventory"]["worktrees"]), result["inventory"]["omitted"]), (50, 2))
        self.assert_parity("new", "feature", "--json")

    def test_unicode_and_shell_metacharacters_in_paths_are_not_interpreted(self):
        root = self.home / "trees 雪 🐍 ' ;"
        self.env["WT_ROOT"] = str(root)
        tree = Path(self.create()["worktree"]["path"])
        self.assertEqual(tree, root / "project/feature")
        self.assert_parity("list", "--json")
        self.assert_parity("enter", "feature")
        self.assert_parity("clean", "feature", "--check", "--json")

    def test_missing_and_float_metadata_fields_cannot_authorize_cleanup(self):
        tree = Path(self.create()["worktree"]["path"])
        record = self.record_path(tree)
        original = json.loads(record.read_text())
        mutations = [{key: value for key, value in original.items() if key != omitted} for omitted in original]
        mutations.append({**original, "version": 1.0})
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                record.write_text(json.dumps(mutation))
                self.assert_parity("list", "--json")
                self.assert_parity("clean", "feature", "--json")
                self.assertTrue(tree.is_dir())
