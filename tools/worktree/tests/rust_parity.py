"""Reuse unchanged executable tests against Rust; run with python tests/rust_parity.py."""
import argparse
from concurrent.futures import ProcessPoolExecutor
import io
import multiprocessing
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import test_cli
import test_github
import test_remote

# The adapter also covers the original concurrent Popen test, not just fixture.wt().
test_cli.CLI = Path(__file__).with_name("rust_cli_adapter.py")


def assert_cleaned_branch(self):
    self.assertEqual(self.git("branch", "--list", "tu/feature"), "")


# Intentional lifecycle change: retain the scenario's dirtiness/ignored-file
# assertions, but assert branch deletion instead of historical Python retention.
test_cli.WorktreeTest.assert_cleaned_branch = assert_cleaned_branch

# These cases call Python internals. Equivalent Rust/process cases are separate.
PYTHON_INTERNALS = {
    "test_delivery_defaults_local_and_repository_family_cannot_enable_github",
    "test_effective_global_or_system_family_controls_default_delivery",
    "test_global_conditional_include_controls_delivery_in_this_repository",
    "test_explicit_delivery_overrides_family_and_invalid_value_refuses_creation",
}


def suite():
    loader = unittest.TestLoader()
    tests = unittest.TestSuite()
    for case in (test_cli.WorktreeTest, test_remote.RemoteCreationTest,
                 test_remote.RepositorySafetyTest, test_github.GithubCleanupTest):
        tests.addTests(test for test in loader.loadTestsFromTestCase(case)
                       if test._testMethodName not in PYTHON_INTERNALS)
    tests.addTests(loader.discover(str(ROOT / "tests"), pattern="rust_test_*.py"))
    return tests


def cases(tests):
    for test in tests:
        if isinstance(test, unittest.TestSuite):
            yield from cases(test)
        else:
            yield test


def run_case(identity):
    # Spawned workers import this module, including the Rust adapter and the
    # intentional cleanup-contract override above. Never use threads for cases
    # that can temporarily change os.environ or other interpreter state.
    output = io.StringIO()
    tests = unittest.defaultTestLoader.loadTestsFromName(identity)
    result = unittest.TextTestRunner(stream=output, verbosity=2, buffer=True).run(tests)
    return {"id": identity, "success": result.wasSuccessful(),
            "tests": result.testsRun, "skipped": len(result.skipped),
            "output": output.getvalue(), "pid": os.getpid()}


def run_parallel(tests, jobs, stream):
    identities = [test.id() for test in cases(tests)]
    reports = []
    with ProcessPoolExecutor(max_workers=jobs,
                             mp_context=multiprocessing.get_context("spawn")) as workers:
        # Ordered reporting avoids interleaved diagnostics; workers still run
        # independently, each with the case's original disposable fixtures.
        for report in workers.map(run_case, identities):
            stream.write(report["output"])
            stream.flush()
            reports.append(report)
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4,
                        help="isolated case workers (1..4; default 4); 1 preserves serial execution")
    args = parser.parse_args()
    tests = suite()
    if args.jobs == 1:
        return not unittest.TextTestRunner(verbosity=2).run(tests).wasSuccessful()
    reports = run_parallel(tests, args.jobs, sys.stderr)
    print(f"Parity total: {sum(row['tests'] for row in reports)} tests, "
          f"{sum(row['skipped'] for row in reports)} skipped; workers={args.jobs}", file=sys.stderr)
    return not all(row["success"] for row in reports)


if __name__ == "__main__":
    sys.exit(main())
