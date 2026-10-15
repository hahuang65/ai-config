"""Synthetic outcomes loaded explicitly by runner tests, never by suite discovery."""
import os
from pathlib import Path
import time
import unittest


class Outcomes(unittest.TestCase):
    def test_pass(self):
        self.assertTrue(True)

    def test_failure(self):
        self.fail("synthetic assertion failure")

    def test_error(self):
        raise RuntimeError("synthetic exception")

    def test_subtest_failure(self):
        with self.subTest(value="fixture"):
            self.fail("synthetic subtest failure")

    @unittest.skip("synthetic environment restriction")
    def test_skip(self):
        pass

    @unittest.expectedFailure
    def test_expected_failure(self):
        self.fail("synthetic expected failure")

    @unittest.expectedFailure
    def test_unexpected_success(self):
        pass

    def test_crash(self):
        os._exit(9)


class Concurrent(unittest.TestCase):
    def meet_peer(self):
        directory = Path(os.environ["WT_PARITY_BARRIER"])
        (directory / str(os.getpid())).touch()
        deadline = time.monotonic() + 5
        while len(list(directory.iterdir())) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(len(list(directory.iterdir())), 2)

    def test_first(self):
        self.meet_peer()

    def test_second(self):
        self.meet_peer()
