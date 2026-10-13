"""Read-only GitHub evidence, bound to the exact branch tip and repository."""
from datetime import datetime
import json
import re
from urllib.parse import urlencode, urlsplit
from .git import WtError, git, run


def _repository_name(candidate):
    if (re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", candidate)
            and all(part not in (".", "..") for part in candidate.split("/"))):
        return candidate
    raise ValueError("Invalid repository name")


def github_repository(url):
    try:
        if not isinstance(url, str):
            raise ValueError("Expected remote URL")
        match = re.fullmatch(r"git@github\.com:([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?", url)
        if match:
            return _repository_name(match[1])
        parsed = urlsplit(url)
        if (parsed.scheme in ("https", "ssh") and parsed.hostname == "github.com"
                and not parsed.password and not parsed.query and not parsed.fragment
                and parsed.port in (None, 443 if parsed.scheme == "https" else 22)
                and (parsed.username is None or parsed.scheme == "ssh" and parsed.username == "git")):
            return _repository_name(parsed.path.strip("/").removesuffix(".git"))
    except ValueError:
        # URL parser errors can contain credentials, including a malformed port.
        pass
    raise WtError("Cleanup requires a recognized github.com remote without embedded credentials.")


def merged_pull_request(repo, metadata, head):
    remote = metadata["remote"]
    if not remote:
        raise WtError("GitHub cleanup requires a configured remote.")
    full_name = github_repository(git(repo.root, "remote", "get-url", remote))
    owner = full_name.split("/")[0]
    query = urlencode({"state": "closed", "head": f"{owner}:{metadata['branch']}", "per_page": 100})
    response = run(["gh", "api", "--hostname", "github.com", f"repos/{full_name}/pulls?{query}"],
                   repo.root, timeout=30)
    try:
        pulls = json.loads(response.stdout)
        if not isinstance(pulls, list):
            raise ValueError("Expected pull requests")
        for pull in pulls:
            if pull.get("merged_at") is None:
                continue
            number = pull["number"]
            if type(number) is not int or number <= 0 or pull["state"] != "closed":
                raise ValueError("Invalid merged pull request")
            datetime.strptime(pull["merged_at"], "%Y-%m-%dT%H:%M:%SZ")
            source, target = pull.get("head", {}), pull.get("base", {})
            if (source.get("sha") == head
                    and source.get("ref") == metadata["branch"]
                    and (source.get("repo") or {}).get("full_name", "").lower() == full_name.lower()
                    and target.get("ref") == metadata["base"]
                    and (target.get("repo") or {}).get("full_name", "").lower() == full_name.lower()):
                return number
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        raise WtError("GitHub returned an invalid response. Worktree retained.") from error
    raise WtError("No merged pull request matches this exact branch tip and integration branch. Worktree retained.")
