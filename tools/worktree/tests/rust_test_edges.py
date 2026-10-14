"""Boundary compatibility: Unix filenames, provider documents and CLI parsing."""
import errno
import json
import os
from pathlib import Path
import subprocess
import sys

from rust_support import BINARY, ROOT, RustFixture
from test_github import FAKE_GH


class UnixBoundaryTest(RustFixture):
    def test_non_utf8_worktree_paths_round_trip_through_json_and_metadata(self):
        self.env["WT_ROOT"] = os.fsdecode(os.fsencode(self.home) + b"/trees-\xff")
        try:
            Path(self.env["WT_ROOT"]).mkdir()
        except OSError as error:
            if error.errno == errno.EILSEQ:
                self.skipTest("This filesystem rejects non-UTF-8 filenames; byte codec has Rust coverage")
            raise
        tree = Path(self.create()["worktree"]["path"])
        self.assertTrue(tree.is_dir())
        self.assert_parity("list", "--json")
        self.assert_parity("enter", "feature", "--json")
        self.assert_parity("clean", "feature", "--check", "--json")
        self.assert_parity("new", "feature", "--json")
        rust = subprocess.run([str(BINARY), "enter", "feature"], cwd=self.repo,
                              env=self.env, capture_output=True, timeout=10)
        original = subprocess.run([sys.executable, str(ROOT / "bin/wt"), "enter", "feature"],
                                  cwd=self.repo, env=self.env, capture_output=True, timeout=10)
        self.assertEqual(rust.stdout, original.stdout)
        self.wt("clean", "feature", "--json")
        self.assertFalse(tree.exists())

    def test_private_use_unicode_does_not_collide_with_unix_byte_encoding(self):
        self.env["WT_ROOT"] = str(self.home / "trees-\U000f0480-\U000f0800")
        tree = Path(self.create()["worktree"]["path"])
        self.assertTrue(tree.is_dir())
        self.assert_parity("list", "--json")
        self.assert_parity("enter", "feature")
        self.assert_parity("clean", "feature", "--check", "--json")
        self.assert_parity("new", "feature", "--json")

    def test_root_dot_and_repeated_separators_have_pathlib_semantics(self):
        self.env["WT_ROOT"] = str(self.home) + "/./trees//"
        self.assert_parity("list", "--json")
        self.assertTrue(Path(self.create()["worktree"]["path"]).is_dir())

    def test_json_objects_cannot_impersonate_the_metadata_version(self):
        tree = Path(self.create()["worktree"]["path"])
        record = self.record_path(tree)
        metadata = json.loads(record.read_text())
        metadata["version"] = {"$serde_json::private::Number": "1"}
        record.write_text(json.dumps(metadata))
        self.assert_parity("list", "--json")
        self.assert_parity("clean", "feature", "--json")
        self.assertTrue(tree.is_dir())

    def test_unicode_decimal_session_pid_has_no_lock_exception(self):
        tree = Path(self.create()["worktree"]["path"])
        owner = str(os.getpid()).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))
        self.env["WT_SESSION_PID"] = owner
        self.git("worktree", "lock", "--reason", f"wt-pi:{owner}", str(tree))
        self.assert_parity("clean", "feature", "--check", "--json", cwd=tree)
        self.wt("clean", "feature", "--check", "--json", cwd=tree, ok=False)
        self.assertTrue(tree.is_dir())


class ArgumentEdgeTest(RustFixture):
    def test_help_aliases_and_option_terminators_match_argparse(self):
        for arguments in (("--", "list"), ("list", "--"), ("--help=x",),
                          ("list", "--help=x"), ("-hh",), ("list", "-hh"),
                          ("new", "--help", "../bad"), ("new", "../bad", "--help"),
                          ("--bad", "new", "--help"), ("-1",), ("list", "-hfoo"),
                          ("--bad", "new"), ("new", "--", "--base")):
            with self.subTest(arguments=arguments):
                self.assert_parity(*arguments)
        self.assertFalse((self.home / "trees").exists())


class GithubDocumentParityTest(RustFixture):
    def setUp(self):
        super().setUp()
        executables = self.home / "bin"
        executables.mkdir()
        provider = executables / "gh"
        provider.write_text(f"#!{sys.executable}\n" + FAKE_GH)
        provider.chmod(0o700)
        self.response = self.home / "response.json"
        self.env.update(PATH=str(executables) + os.pathsep + self.env["PATH"],
                        FAKE_GH_CALLS=str(self.home / "calls.jsonl"),
                        FAKE_GH_RESPONSE=str(self.response))
        self.git("remote", "add", "origin", "https://github.com/example/project.git")
        self.git("config", "wt.base", "main")
        self.git("config", "wt.delivery", "github")
        self.tree = Path(self.create("feature", "--local")["worktree"]["path"])
        self.pull = {"number": 123, "state": "closed", "merged_at": "2026-06-01T10:00:00Z",
                     "head": {"sha": self.git("rev-parse", "HEAD", cwd=self.tree),
                              "ref": "tu/feature", "repo": {"full_name": "example/project"}},
                     "base": {"ref": "main", "repo": {"full_name": "example/project"}}}

    def test_missing_and_malformed_identity_fields_match_python_fail_closed_rules(self):
        mutations = [{key: value for key, value in self.pull.items() if key != omitted}
                     for omitted in self.pull]
        for side in ("head", "base"):
            mutations.extend({**self.pull, side: value} for value in (None, {}, [], "", 0, False))
            mutations.extend({**self.pull, side: {**self.pull[side], "repo": value}}
                             for value in (None, {}, [], "", 0, False, {"full_name": None}))
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.response.write_text(json.dumps([mutation]))
                self.assert_parity("clean", "feature", "--check", "--json")
        self.assertTrue(self.tree.is_dir())

    def test_merge_date_validation_matches_python_calendar_semantics(self):
        for timestamp in ("2024-02-29T23:59:59Z", "2023-02-29T10:00:00Z",
                          "2026-6-1T1:2:3Z", "2026-06- 1T10:00:00Z",
                          "2026-06-01t10:00:00z", "0000-01-01T00:00:00Z",
                          "2026-06-01T24:00:00Z", "2026-06-01T10:00:60Z"):
            with self.subTest(timestamp=timestamp):
                self.response.write_text(json.dumps([{**self.pull, "merged_at": timestamp}]))
                self.assert_parity("clean", "feature", "--check", "--json")

    def test_json_objects_cannot_impersonate_a_pull_request_number(self):
        self.response.write_text(json.dumps([{**self.pull, "number": {"$serde_json::private::Number": "123"}}]))
        self.assert_parity("clean", "feature", "--check", "--json")
        self.assertTrue(self.tree.is_dir())

    def test_merge_proof_accepts_positive_integers_without_accepting_floats(self):
        for number in (2 ** 80, 1.0, 1e20, True, 0, -1):
            with self.subTest(number=number):
                self.response.write_text(json.dumps([{**self.pull, "number": number}]))
                self.assert_parity("clean", "feature", "--check", "--json")

    def test_provider_output_limit_retains_the_worktree_without_echoing_output(self):
        self.response.write_text("x" * 8_000_001)
        result = self.assert_parity("clean", "feature", "--json")
        self.assertIn("too much output", result.stderr)
        self.assertTrue(self.tree.is_dir())
