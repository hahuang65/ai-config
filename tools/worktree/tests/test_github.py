"""GitHub cleanup proof via a fake gh executable, never a live provider."""
import copy
import json
import os
from pathlib import Path
import sys
import subprocess
import unittest
from urllib.parse import parse_qs, urlsplit

import test_remote
from wt.git import WtError
from wt.github import github_repository


FAKE_GH = '''
import json
import os
from pathlib import Path
import subprocess
import sys

with Path(os.environ["FAKE_GH_CALLS"]).open("a") as stream:
    stream.write(json.dumps(sys.argv[1:]) + "\\n")
if os.environ.get("FAKE_GH_MOVE_HEAD"):
    subprocess.run(["git", "-C", os.environ["FAKE_GH_MOVE_HEAD"], "commit",
                    "--allow-empty", "-m", "Concurrent fixture change"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
sys.stdout.write(Path(os.environ["FAKE_GH_RESPONSE"]).read_text())
sys.stderr.write(os.environ.get("FAKE_GH_ERROR", ""))
sys.exit(int(os.environ.get("FAKE_GH_EXIT", "0")))
'''


class GithubCleanupTest(test_remote.GitFixture):
    def setUp(self):
        super().setUp()
        executables = self.home / "bin"
        executables.mkdir()
        gh = executables / "gh"
        gh.write_text(f"#!{sys.executable}\n" + FAKE_GH)
        gh.chmod(0o700)
        self.calls = self.home / "gh-calls.jsonl"
        self.response = self.home / "gh-response.json"
        self.env.update(PATH=str(executables) + os.pathsep + self.env["PATH"],
                        FAKE_GH_CALLS=str(self.calls), FAKE_GH_RESPONSE=str(self.response))
        self.git("remote", "add", "origin", "https://github.com/example/project.git")
        self.git("config", "wt.base", "main")
        self.git("config", "wt.delivery", "github")
        self.tree = Path(self.create("feature", "--local")["worktree"]["path"])
        self.commit_work(self.tree)
        self.head = self.git("rev-parse", "HEAD", cwd=self.tree)
        self.pull = {"number": 123, "state": "closed", "merged_at": "2026-06-01T10:00:00Z",
                     "head": {"sha": self.head, "ref": "tu/feature",
                              "repo": {"full_name": "example/project"}},
                     "base": {"ref": "main", "repo": {"full_name": "example/project"}}}
        self.respond([self.pull])

    def respond(self, payload):
        self.response.write_text(json.dumps(payload))

    def assert_retained(self):
        result = self.wt("clean", "feature", "--json", ok=False)
        self.assertTrue(self.tree.is_dir())
        self.assertEqual(self.git("rev-parse", "tu/feature"), self.git("rev-parse", "HEAD", cwd=self.tree))
        self.assertNotIn("Traceback", result.stderr)
        return result

    def test_exact_merged_pull_allows_squash_cleanup_and_retains_branch(self):
        self.git("merge", "--squash", "tu/feature")
        self.git("commit", "-m", "Squash fixture")
        comparison = subprocess_result(self, "merge-base", "--is-ancestor", self.head, "main")
        self.assertEqual(comparison.returncode, 1)
        result = json.loads(self.wt("clean", "feature", "--json").stdout)
        self.assertTrue(result["removed"])
        self.assertEqual(result["proof"], "merged pull request #123")
        self.assertFalse(self.tree.exists())
        self.assertEqual(self.git("rev-parse", "tu/feature"), self.head)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:3], ["api", "--hostname", "github.com"])
        self.assertEqual(len(calls[0]), 4)
        endpoint = urlsplit(calls[0][3])
        self.assertEqual(endpoint.path, "repos/example/project/pulls")
        self.assertEqual(parse_qs(endpoint.query),
                         {"state": ["closed"], "head": ["example:tu/feature"], "per_page": ["100"]})

    def test_check_obtains_github_proof_without_removing_worktree(self):
        result = json.loads(self.wt("clean", "feature", "--check", "--json").stdout)
        self.assertFalse(result["removed"])
        self.assertEqual(result["proof"], "merged pull request #123")
        self.assertTrue(self.tree.is_dir())

    def test_unmerged_closed_pull_is_preserved_even_if_local_history_is_integrated(self):
        self.git("merge", "--ff-only", "tu/feature")
        self.pull["merged_at"] = None
        self.respond([self.pull])
        self.assert_retained()

    def test_every_exact_identity_component_is_required(self):
        changes = [("head", "sha", "0" * 40), ("head", "ref", "tu/other"),
                   ("base", "ref", "release"), ("head", "repo", {"full_name": "fork/project"}),
                   ("base", "repo", {"full_name": "example/other"}),
                   ("head", "repo", None), ("base", "repo", None)]
        for side, field, value in changes:
            with self.subTest(side=side, field=field, value=value):
                pull = copy.deepcopy(self.pull)
                pull[side][field] = value
                self.respond([pull])
                self.assert_retained()

    def test_fork_pull_cannot_prove_delivery_to_the_fork_remote(self):
        self.git("remote", "set-url", "origin", "git@github.com:fork/project.git")
        self.pull["head"]["repo"]["full_name"] = "fork/project"
        self.respond([self.pull])
        self.assert_retained()

    def test_deleted_or_rewritten_head_after_merge_is_preserved(self):
        self.git("commit", "--allow-empty", "-m", "New work after merge", cwd=self.tree)
        self.assert_retained()

    def test_case_insensitive_repository_identity_is_supported(self):
        self.pull["head"]["repo"]["full_name"] = "EXAMPLE/Project"
        self.pull["base"]["repo"]["full_name"] = "Example/PROJECT"
        self.respond([self.pull])
        result = json.loads(self.wt("clean", "feature", "--check", "--json").stdout)
        self.assertEqual(result["proof"], "merged pull request #123")

    def test_empty_and_malformed_api_responses_fail_closed(self):
        for payload in ([], None, {}, "", 5, [None], ["bad"], [{"head": []}],
                        [{**self.pull, "head": None}], [{**self.pull, "base": []}]):
            with self.subTest(payload=payload):
                self.respond(payload)
                self.assert_retained()
        self.response.write_text("not json")
        self.assert_retained()

    def test_invalid_merge_evidence_cannot_authorize_cleanup(self):
        for key, value in [("number", None), ("number", True), ("number", 0),
                           ("number", -1), ("number", "123"), ("number", []),
                           ("merged_at", True), ("merged_at", 42),
                           ("merged_at", "not-a-date"), ("state", "open")]:
            with self.subTest(key=key, value=value):
                self.respond([{**self.pull, key: value}])
                self.wt("clean", "feature", "--check", "--json", ok=False)
                self.assert_retained()

    def test_api_error_does_not_echo_credentials_or_accept_its_stdout(self):
        sentinel = "fixture-secret-do-not-log"
        self.env.update(FAKE_GH_EXIT="1", FAKE_GH_ERROR=f"authorization: Bearer {sentinel}")
        result = self.assert_retained()
        self.assertNotIn(sentinel, result.stdout + result.stderr)
        self.assertIn("failed", result.stderr)

    def test_credentials_in_remote_are_rejected_without_logging_or_api_call(self):
        sentinel = "fixture-secret-do-not-log"
        for remote in (f"https://user:{sentinel}@github.com/example/project.git",
                       f"https://github.com:{sentinel}/example/project.git"):
            with self.subTest(remote=remote):
                self.git("remote", "set-url", "origin", remote)
                result = self.assert_retained()
                self.assertNotIn(sentinel, result.stdout + result.stderr)
                self.assertFalse(self.calls.exists())

    def test_missing_remote_refuses_before_calling_provider(self):
        record = self.record_path(self.tree)
        metadata = json.loads(record.read_text())
        metadata["remote"] = None
        record.write_text(json.dumps(metadata))
        self.assert_retained()
        self.assertFalse(self.calls.exists())

    def test_head_change_during_provider_lookup_prevents_removal(self):
        self.env["FAKE_GH_MOVE_HEAD"] = str(self.tree)
        result = self.assert_retained()
        self.assertIn("changed during cleanup", result.stderr)
        self.assertNotEqual(self.git("rev-parse", "HEAD", cwd=self.tree), self.head)

    def test_many_nonmatching_pulls_do_not_hide_an_exact_match(self):
        unmatched = {**self.pull, "head": {**self.pull["head"], "ref": "tu/other"}}
        self.respond([unmatched] * 10_000 + [self.pull])
        result = json.loads(self.wt("clean", "feature", "--check", "--json").stdout)
        self.assertEqual(result["proof"], "merged pull request #123")
        self.assertTrue(self.tree.is_dir())


def subprocess_result(fixture, *arguments):
    return subprocess.run(["git", "-C", str(fixture.repo), *arguments], env=fixture.env,
                          capture_output=True, text=True, timeout=10)


class GithubRepositoryTest(unittest.TestCase):
    def test_supported_credential_free_urls_have_exact_repository_identity(self):
        for url in ("git@github.com:example/project.git", "git@github.com:example/project",
                    "https://github.com/example/project.git", "https://github.com/example/project",
                    "https://github.com:443/example/project.git", "ssh://git@github.com/example/project.git",
                    "ssh://git@github.com:22/example/project.git"):
            with self.subTest(url=url):
                self.assertEqual(github_repository(url), "example/project")

    def test_unsupported_or_malformed_urls_raise_safe_operational_errors(self):
        for url in (None, 0, [], "", "https://github.com/example", "https://github.com/../project",
                    "https://github.com/example/..", "https://github.com/example/project/extra",
                    "https://github.com/example/project?token=secret", "https://github.com/example/project#secret",
                    "https://github.com:secret/example/project", "https://[github.com/example/project",
                    "https://user:secret@github.com/example/project", "https://secret@github.com/example/project",
                    "https://github.com:444/example/project", "ssh://user@github.com/example/project",
                    "git@elsewhere.test:example/project.git", "https://github.com.evil.test/example/project",
                    "https://github.com/example/雪🐍';"):
            with self.subTest(url=url):
                with self.assertRaises(WtError) as error:
                    github_repository(url)
                self.assertNotIn("secret", str(error.exception))


if __name__ == "__main__":
    unittest.main()
