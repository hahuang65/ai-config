"""Reuse unchanged executable tests against Rust; run with python tests/rust_parity.py."""
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


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(suite())
    sys.exit(not result.wasSuccessful())
