"""Bounded process execution and Git's worktree inventory."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import subprocess


class WtError(Exception):
    """An operational failure that must leave work available for recovery."""


def run(arguments, cwd, *, check=True, timeout=30):
    environment = {key: value for key, value in os.environ.items()
                   if key not in {"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"}}
    environment.update(GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    try:
        result = subprocess.run(arguments, cwd=cwd, env=environment, capture_output=True,
                                text=True, errors="surrogateescape", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise WtError(f"Could not complete {arguments[0]}: {error}. Check wt list before retrying.") from error
    if len(result.stdout) > 8_000_000:
        raise WtError(f"{arguments[0]} returned too much output; no further action taken.")
    if check and result.returncode:
        # Do not echo remote URLs or arbitrary command output, which may contain credentials.
        raise WtError(f"{arguments[0]} {arguments[1]} failed (exit {result.returncode}). "
                      "Check repository access and state, then retry.")
    return result


def git(cwd, *arguments, check=True):
    return run(["git", "--no-pager", *arguments], cwd, check=check).stdout.strip()


def git_result(cwd, *arguments):
    return run(["git", "--no-pager", *arguments], cwd, check=False)


def config(cwd, key):
    return git(cwd, "config", "--get", key, check=False)


def commit(cwd, ref):
    result = git_result(cwd, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
    return result.stdout.strip() if result.returncode == 0 else None


def ancestor(cwd, older, newer):
    result = git_result(cwd, "merge-base", "--is-ancestor", older, newer)
    if result.returncode not in (0, 1):
        raise WtError("Could not compare commit history; cleanup stopped.")
    return result.returncode == 0


def inventory(cwd):
    output = git(cwd, "worktree", "list", "--porcelain", "-z")
    worktrees = []
    for entry in output.split("\0\0"):
        fields = {}
        for line in entry.split("\0"):
            if line:
                key, _, value = line.partition(" ")
                fields[key] = value
        if "worktree" in fields:
            worktrees.append(fields)
    return worktrees


def git_path(cwd, name):
    value = git(cwd, "rev-parse", "--path-format=absolute", "--git-path", name)
    return Path(value)


@contextmanager
def repository_lock(common):
    """Serialize wt operations, not unrelated Git operations or running agents."""
    lock = common / "wt-operation.lock"
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(lock, flags, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise WtError("Another wt operation is running for this repository. Retry when it finishes.") from error
        yield
    finally:
        os.close(descriptor)
