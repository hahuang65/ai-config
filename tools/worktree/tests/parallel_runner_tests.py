"""Keep parallel parity exhaustive, isolated, bounded, and fail-closed."""
from concurrent.futures.process import BrokenProcessPool
from contextlib import redirect_stderr
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import rust_parity


def selected(identities):
    return unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name)
                              for name in identities)


class ParityRunnerTest(unittest.TestCase):
    def test_fixture_regressions_run_once_in_the_real_parity_inventory(self):
        names = (
            "copies_preserve_bytes_and_modes_without_sharing_writable_state",
            "fixture_shapes_initialize_once_per_process_without_persistent_reuse",
            "invalid_shapes_and_nonempty_destinations_do_not_write_or_run_git",
            "seed_maintenance_settings_are_command_local_and_not_copied",
            "unsafe_or_oversized_capture_fails_without_poisoning_later_fixtures",
        )
        prefix = "rust_test_repository.RepositoryFixtureTest.test_"
        identities = [test.id() for test in rust_parity.cases(rust_parity.suite())]
        self.assertEqual(sorted(name for name in identities if name.startswith(prefix)),
                         sorted(prefix + name for name in names))

    def test_parallel_preserves_every_case_and_all_unittest_outcomes(self):
        identities = [f"parallel_fixture.Outcomes.test_{name}" for name in
                      ("pass", "failure", "error", "subtest_failure", "skip",
                       "expected_failure", "unexpected_success")]
        serial = [rust_parity.run_case(name) for name in identities]
        stream = io.StringIO()
        parallel = rust_parity.run_parallel(selected(identities), 2, stream)
        fields = ("id", "success", "tests", "skipped")
        self.assertEqual([tuple(row[key] for key in fields) for row in parallel],
                         [tuple(row[key] for key in fields) for row in serial])
        self.assertTrue(all(row["pid"] != os.getpid() for row in parallel))
        self.assertEqual([row["success"] for row in parallel],
                         [True, False, False, False, True, True, False])
        for message in ("synthetic assertion failure", "synthetic exception",
                        "synthetic subtest failure", "synthetic environment restriction",
                        "expected failure", "unexpected success"):
            self.assertIn(message, stream.getvalue())

    def test_workers_overlap_without_exceeding_the_selected_process_bound(self):
        identities = [f"parallel_fixture.Concurrent.test_{name}" for name in ("first", "second")]
        with tempfile.TemporaryDirectory() as directory, patch.dict(
                os.environ, {"WT_PARITY_BARRIER": directory}):
            reports = rust_parity.run_parallel(selected(identities), 2, io.StringIO())
        self.assertTrue(all(row["success"] for row in reports), reports)
        self.assertEqual(len({row["pid"] for row in reports}), 2)

    def test_worker_crash_cannot_be_reported_as_a_successful_gate(self):
        with self.assertRaises(BrokenProcessPool):
            rust_parity.run_parallel(selected(["parallel_fixture.Outcomes.test_crash"]),
                                     2, io.StringIO())

    def test_main_propagates_failing_test_status_and_serial_mode_stays_serial(self):
        for jobs in (1, 2):
            with patch.object(sys, "argv", ["rust_parity.py", "--jobs", str(jobs)]), \
                 patch.object(rust_parity, "suite", return_value=selected(
                     ["parallel_fixture.Outcomes.test_failure"])), redirect_stderr(io.StringIO()):
                self.assertTrue(rust_parity.main())
        with patch.object(sys, "argv", ["rust_parity.py", "--jobs", "1"]), \
             patch.object(rust_parity, "suite", return_value=selected(
                 ["parallel_fixture.Outcomes.test_pass"])), \
             patch.object(rust_parity, "run_parallel", side_effect=AssertionError("must be serial")), \
             redirect_stderr(io.StringIO()):
            self.assertFalse(rust_parity.main())

    def test_cli_rejects_unbounded_or_invalid_worker_counts_before_running_tests(self):
        runner = Path(rust_parity.__file__)
        for value in ("0", "5", "-1", "many"):
            result = subprocess.run([sys.executable, str(runner), "--jobs", value],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertNotIn("Ran ", result.stderr)
