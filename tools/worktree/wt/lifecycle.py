"""Explicit worktree creation and conservative removal; never commit or publish."""
import json
from pathlib import Path
import re
import sys
from .git import WtError, ancestor, commit, config, git, git_path, git_result, inventory
from .github import merged_pull_request


def identity(entry):
    return {key: entry[key] for key in ("path", "task", "branch", "base", "managed")}


def outcome(repo, command, entry=None, kind="none", target=None):
    result = {"protocolVersion": 1, "command": command, "project": repo.summary,
              "transition": {"kind": kind, "targetPath": str(target or repo.cwd)}}
    if entry:
        result["worktree"] = identity(entry)
    return result


def list_worktrees(repo):
    result = outcome(repo, "list")
    result["worktrees"] = repo.entries()
    return result


def reminder(repo):
    entries = repo.entries()
    print("Existing worktrees:", file=sys.stderr)
    for entry in entries[:50]:
        kind = "task" if entry["managed"] else "unmanaged"
        print(f"  {entry['task']} [{kind}, {entry['branch'] or 'detached'}] {entry['path']}", file=sys.stderr)
    if len(entries) > 50:
        print(f"  {len(entries) - 50} more. Run wt list --all.", file=sys.stderr)
    return {"worktrees": [identity(entry) for entry in entries[:50]], "omitted": max(0, len(entries) - 50)}


def new(repo, task, base, local):
    existing = reminder(repo)
    target = repo.directory / task
    if target.exists() or target.is_symlink():
        raise WtError("The task directory already exists. Use wt enter TASK or choose another name.")
    initials = config(repo.root, "wt.initials")
    if not initials:
        initials = "".join(word[0] for word in config(repo.root, "user.name").split()).lower()
    if not re.fullmatch(r"[a-zA-Z0-9]+", initials or ""):
        raise WtError("Set git config wt.initials INITIALS before creating a task.")
    branch = f"{initials}/{task}"
    if git_result(repo.root, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}").returncode == 0:
        raise WtError("The task branch already exists. Choose another task name; wt never resets a branch.")
    delivery = repo.delivery()
    start = repo.starting_commit(base, local)
    repo.claim_directory()
    git(repo.root, "worktree", "add", "--no-track", "-b", branch, str(target), start)
    metadata = {"version": 1, "task": task, "path": str(target), "branch": branch,
                "base": repo.base, "remote": repo.remote, "delivery": delivery}
    try:
        with git_path(target, "wt.json").open("x") as stream:
            json.dump(metadata, stream, sort_keys=True)
    except OSError as error:
        raise WtError(f"Worktree created at {target}, but its wt record could not be saved. "
                      "It remains visible as unmanaged; inspect it before retrying.") from error
    result = outcome(repo, "new", {**metadata, "managed": True}, "enter-worktree", target)
    result["inventory"] = existing
    return result


def enter(repo, task):
    entry = repo.selected(task)
    if entry["locked"]:
        raise WtError("This worktree is locked by Git. Inspect its reason before changing that protection.")
    return outcome(repo, "enter", entry, "enter-worktree", entry["path"])


def current_inside(repo, entry):
    return repo.cwd.is_relative_to(Path(entry["path"]))


def validate_clean(repo, task):
    entry = repo.selected(task)
    path = Path(entry["path"])
    if entry["locked"]:
        raise WtError("This worktree is locked by Git. Inspect its reason before changing that protection.")
    status = git(path, "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none")
    if status:
        raise WtError("The worktree has modified tracked or non-ignored untracked files. Save them before cleanup.")
    # Refuse in-progress operations even when the index happens to be clean.
    for marker in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"):
        if git_path(path, marker).exists():
            raise WtError("A Git operation is still in progress in this worktree. Finish it before cleanup.")
    metadata = repo.metadata(path)
    head = commit(path, "HEAD")
    if not head:
        raise WtError("The task has no valid commit. Cleanup stopped.")
    if metadata["delivery"] == "github":
        proof = f"merged pull request #{merged_pull_request(repo, metadata, head)}"
    else:
        integrated = commit(repo.root, f"refs/heads/{metadata['base']}")
        if not integrated or not ancestor(repo.root, head, integrated):
            raise WtError("The exact task tip is not integrated into the local target branch. Worktree retained.")
        proof = f"integrated into {metadata['base']}"
    return entry, head, proof


def clean_one(repo, task, check=False):
    entry, head, proof = validate_clean(repo, task)
    inside = current_inside(repo, entry)
    result = outcome(repo, "clean", entry, "return-main" if inside else "none", repo.root if inside else repo.cwd)
    result["proof"] = proof
    result["removed"] = False
    if check or inside:
        return result
    # Git checks tracked/untracked dirtiness and locks again during removal.
    # Recheck identity immediately before that operation; never use --force.
    latest = repo.selected(task)
    if latest != entry or commit(entry["path"], "HEAD") != head:
        raise WtError("The worktree changed during cleanup. Nothing was removed; retry after activity stops.")
    git(repo.root, "worktree", "remove", entry["path"])
    result["removed"] = True
    return result


def clean(repo, task=None, check=False):
    if task:
        return clean_one(repo, task, check)
    results = []
    for entry in repo.entries():
        if not entry["managed"]:
            continue
        try:
            results.append(clean_one(repo, entry["task"], check))
        except WtError as error:
            results.append({"worktree": identity(entry), "removed": False, "reason": str(error)})
    result = outcome(repo, "clean")
    result["results"] = results
    return result
