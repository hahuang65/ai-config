"""Two bounded, immutable initial Git snapshots; never cache test outcomes."""
import stat

MAX_ENTRIES = 128
MAX_BYTES = 256 * 1024


class RepositorySeeds:
    def __init__(self):
        self._templates = {}

    def prepare(self, root, git, *, ignored=False):
        if type(ignored) is not bool:
            raise ValueError("Unknown repository fixture shape")
        if any(root.iterdir()):
            raise ValueError("Repository fixture must start empty")
        if ignored not in self._templates:
            _initialize(root, git, ignored)
            self._templates[ignored] = _capture(root)
        else:
            _restore(root, self._templates[ignored])


def _initialize(root, git, ignored):
    git("init", "-b", "main")
    git("config", "user.name", "Test User")
    git("config", "user.email", "test@example.invalid")
    git("config", "commit.gpgsign", "false")
    if ignored:
        (root / ".gitignore").write_text("generated/\n")
        git("add", ".gitignore")
        commit = ("-m", "TEST: Initialize disposable repository")
    else:
        commit = ("--allow-empty", "-m", "Initialize fixture")
    # The seed must be quiescent before capture. These command-local settings
    # do not change the copied repository's configuration or later Git calls.
    git("-c", "maintenance.auto=false", "-c", "gc.auto=0", "commit", *commit)


def _capture(root):
    entries = []
    remaining = MAX_BYTES
    for path in root.rglob("*"):
        if len(entries) == MAX_ENTRIES:
            raise ValueError("Repository snapshot has too many entries")
        mode = path.lstat().st_mode
        if path.name.endswith(".lock"):
            raise ValueError("Repository snapshot contains an active lock")
        if stat.S_ISDIR(mode):
            data = None
        elif stat.S_ISREG(mode):
            with path.open("rb") as stream:
                data = stream.read(remaining + 1)
            remaining -= len(data)
            if remaining < 0:
                raise ValueError("Repository snapshot is too large")
        else:
            raise ValueError("Repository snapshot contains a non-regular entry")
        entries.append((path.relative_to(root), stat.S_IMODE(mode), data))
    return tuple(entries)


def _restore(root, entries):
    for relative, mode, data in entries:
        target = root / relative
        if data is None:
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        target.chmod(mode)


# Each serial invocation or spawned parity worker owns at most two templates.
# Only relative paths, modes and immutable bytes survive seed initialization.
INITIAL_REPOSITORIES = RepositorySeeds()
