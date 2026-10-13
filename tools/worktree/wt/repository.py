"""Repository identity, integration branch selection, and small worktree records."""
import json
import os
from pathlib import Path
import re
from .git import WtError, ancestor, commit, config, git, git_result, inventory, run

TASK_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")


def task_name(value):
    if not isinstance(value, str) or not TASK_PATTERN.fullmatch(value):
        raise ValueError("TASK must contain 1–64 letters, digits, underscores, or hyphens and start with a letter or digit.")
    return value


class Repository:
    def __init__(self, cwd):
        self.cwd = Path(cwd).resolve()
        self.common = Path(git(self.cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"))
        entries = inventory(self.cwd)
        if not entries or "bare" in entries[0]:
            raise WtError("Run wt inside a non-bare Git repository.")
        self.root = Path(entries[0]["worktree"]).resolve()
        if self.root == (Path.home() / ".dotfiles").resolve():
            raise WtError("The dotfiles parent is not a task repository. Run wt inside the affected submodule.")
        if not self.root.is_dir():
            raise WtError("The main checkout is missing. Restore it before using wt.")
        root_setting = os.environ.get("WT_ROOT", str(Path.home() / ".worktrees"))
        self.worktree_root = Path(root_setting).expanduser().absolute()
        if self.worktree_root.is_symlink() or self.worktree_root.resolve() != self.worktree_root:
            raise WtError("The worktree root must be a canonical directory, not a symlink.")
        self.name = config(self.root, "wt.project") or self.root.name
        try:
            task_name(self.name)
        except ValueError as error:
            raise WtError("Set git config wt.project to a short, safe project name.") from error
        self.directory = self.worktree_root / self.name
        remotes = git(self.root, "remote").splitlines()
        configured_remote = config(self.root, "wt.remote")
        if configured_remote and configured_remote not in remotes:
            raise WtError("Configured wt.remote does not exist.")
        if configured_remote:
            self.remote = configured_remote
        elif "origin" in remotes:
            self.remote = "origin"
        elif len(remotes) <= 1:
            self.remote = remotes[0] if remotes else None
        else:
            raise WtError("Several remotes exist. Select the integration remote with git config wt.remote NAME.")
        self.base = self.find_base()

    def find_base(self):
        configured = config(self.root, "wt.base")
        if configured:
            base = configured
        elif self.remote:
            symbolic = git(self.root, "symbolic-ref", "--quiet", f"refs/remotes/{self.remote}/HEAD", check=False)
            prefix = f"refs/remotes/{self.remote}/"
            if not symbolic.startswith(prefix):
                raise WtError("The remote default branch is unknown. Run git remote set-head REMOTE -a or set git config wt.base BRANCH.")
            base = symbolic[len(prefix):]
        else:
            candidates = [branch for branch in ("main", "master") if commit(self.root, f"refs/heads/{branch}")]
            if len(candidates) != 1:
                raise WtError("Set git config wt.base BRANCH to identify the integration branch; an initial commit is required.")
            base = candidates[0]
        if base.startswith("-") or git_result(self.root, "check-ref-format", f"refs/heads/{base}").returncode:
            raise WtError("wt.base must name a branch, not an arbitrary revision.")
        return base

    @property
    def summary(self):
        return {"root": str(self.root), "name": self.name, "base": self.base}

    def claim_directory(self):
        self.worktree_root.mkdir(parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise WtError("The project worktree directory must not be a symlink.")
        self.directory.mkdir(exist_ok=True)
        owner = self.directory / ".repository"
        try:
            with owner.open("x") as stream:
                stream.write(str(self.common) + "\n")
        except FileExistsError:
            if owner.is_symlink() or owner.read_text().strip() != str(self.common):
                raise WtError("Another repository owns this worktree directory. Set a unique git config wt.project NAME.")

    def fetch(self):
        if self.remote:
            result = run(["git", "fetch", "--no-tags", self.remote,
                          f"refs/heads/{self.base}:refs/remotes/{self.remote}/{self.base}"],
                         self.root, check=False, timeout=90)
            if result.returncode:
                raise WtError("Could not fetch the integration branch. Fix remote access or explicitly use wt new TASK --local.")

    def starting_commit(self, override=None, local=False):
        if not local:
            self.fetch()
        if override:
            start = commit(self.root, override)
            if not start:
                raise WtError("The requested base does not resolve to a local commit. Fetch it explicitly, then retry.")
            return start
        local_tip = commit(self.root, f"refs/heads/{self.base}")
        remote_tip = None if local or not self.remote else commit(self.root, f"refs/remotes/{self.remote}/{self.base}")
        if local_tip and remote_tip:
            if ancestor(self.root, local_tip, remote_tip):
                return remote_tip
            if ancestor(self.root, remote_tip, local_tip):
                return local_tip
            raise WtError("Local and remote integration branches have diverged. Resolve this or choose an explicit --base.")
        if local_tip or remote_tip:
            return local_tip or remote_tip
        raise WtError("The integration branch has no commit. Create the initial project commit before starting a task.")

    def delivery(self):
        explicit = config(self.root, "wt.delivery")
        if explicit:
            if explicit not in ("local", "github"):
                raise WtError("wt.delivery must be local or github.")
            return explicit
        # Honor the machine's A5 classification without depending on Orchard.
        family = ""
        for scope in ("--system", "--global"):
            result = git_result(self.root, "config", scope, "--includes", "--get", "ai.projectFamily")
            if result.returncode == 0:
                family = result.stdout.strip()
        return "github" if family == "a5" else "local"

    def entries(self):
        result = []
        for entry in inventory(self.root):
            path = Path(entry["worktree"])
            metadata = self.metadata(path)
            result.append({"path": str(path), "branch": entry.get("branch", "").removeprefix("refs/heads/"),
                           "task": metadata["task"] if metadata else path.name,
                           "base": metadata["base"] if metadata else self.base,
                           "managed": metadata is not None, "locked": "locked" in entry,
                           "lockReason": entry.get("locked", ""), "head": entry.get("HEAD", ""),
                           "missing": not path.is_dir()})
        return result

    def metadata(self, path):
        if path == self.root or path.parent != self.directory or path.is_symlink() or not path.is_dir():
            return None
        owner = self.directory / ".repository"
        if not owner.is_file() or owner.is_symlink() or owner.read_text().strip() != str(self.common):
            return None
        # --git-path resolves the final symlink, which would hide a redirected record.
        record = Path(git(path, "rev-parse", "--absolute-git-dir")) / "wt.json"
        try:
            if record.is_symlink():
                return None
            data = json.loads(record.read_text())
            required = {"version", "path", "task", "branch", "base", "remote", "delivery"}
            if (not isinstance(data, dict) or set(data) != required
                    or type(data["version"]) is not int or data["version"] != 1 or data["path"] != str(path)):
                return None
            if data["task"] != path.name or not TASK_PATTERN.fullmatch(data["task"]):
                return None
            for key in ("branch", "base"):
                if (not isinstance(data[key], str) or not data[key] or data[key].startswith("-")
                        or git_result(self.root, "check-ref-format", f"refs/heads/{data[key]}").returncode):
                    return None
            if data["delivery"] not in ("local", "github") or (data["remote"] is not None and not isinstance(data["remote"], str)):
                return None
            return data
        except (OSError, ValueError, TypeError):
            return None

    def selected(self, task):
        matches = [entry for entry in self.entries() if entry["managed"] and entry["task"] == task]
        if len(matches) != 1:
            raise WtError(f"No managed worktree named {task}. Use wt list to see available tasks.")
        entry = matches[0]
        metadata = self.metadata(Path(entry["path"]))
        if entry["branch"] != metadata["branch"]:
            raise WtError("The worktree branch changed since creation. Restore its original branch before using wt.")
        return entry
