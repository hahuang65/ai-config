"""Small command interface; parsing completes before any repository side effects."""
import argparse
import json
from pathlib import Path
import sys
from .git import WtError, repository_lock
from . import lifecycle
from .repository import Repository, task_name


def task_argument(value):
    try:
        return task_name(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def parser():
    cli = argparse.ArgumentParser(prog="wt", description="Create, resume, and safely remove task worktrees. Never commits or publishes.", allow_abbrev=False)
    commands = cli.add_subparsers(dest="command", required=True)
    for name, help_text in [("new", "Create a task branch and worktree"), ("enter", "Print an existing task's path"),
                            ("list", "List this project's worktrees without network access"),
                            ("clean", "Remove integrated, clean tasks; ignored files are disposable")]:
        command = commands.add_parser(name, help=help_text, allow_abbrev=False)
        command.add_argument("--json", action="store_true", help="Emit protocol version 1 JSON; diagnostics stay on stderr")
        if name in ("new", "enter"):
            command.add_argument("task", type=task_argument)
        if name == "new":
            command.add_argument("--base", help="Explicit starting revision (does not change the integration target)")
            command.add_argument("--local", action="store_true", help="Use local history without fetching")
        if name == "clean":
            command.add_argument("task", nargs="?", type=task_argument)
            command.add_argument("--check", action="store_true", help="Check safety without removing anything")
        if name == "list":
            command.add_argument("--all", action="store_true", help="Show every worktree instead of the first 50")
    return cli


def render(result):
    command = result["command"]
    if command in ("new", "enter"):
        return result["worktree"]["path"] + "\n"
    if command == "list":
        lines = [f"{w['task']}: {w['branch'] or 'detached'}{' [locked]' if w['locked'] else ''}"
                 f"{' [unmanaged]' if not w['managed'] else ''}\n  {w['path']}" for w in result["worktrees"]]
        if result["omitted"]:
            lines.append(f"{result['omitted']} more worktrees. Use wt list --all.")
        return "\n".join(lines) + "\n"
    if "results" in result:
        if not result["results"]:
            return "No managed worktrees to clean.\n"
        return "".join(render(item) if "command" in item else f"Kept {item['worktree']['task']}: {item['reason']}\n"
                       for item in result["results"])
    task = result["worktree"]["task"]
    if result["removed"]:
        return f"Removed {task}; {result['proof']}. Branch retained.\n"
    if result["transition"]["kind"] == "return-main":
        return f"Return to {result['project']['root']}, then run wt clean {task}. Nothing removed yet.\n"
    return f"Safe to remove {task}; {result['proof']}. Nothing removed in check mode.\n"


def main(argv=None):
    cli = parser()
    args = cli.parse_args(argv)
    if args.command == "new" and args.base and (args.base.startswith("-") or any(ord(char) < 32 for char in args.base)):
        cli.error("--base must be a revision, not an option or control sequence")
    try:
        repo = Repository(Path.cwd())
        with repository_lock(repo.common):
            if args.command == "new":
                result = lifecycle.new(repo, args.task, args.base, args.local)
            elif args.command == "enter":
                result = lifecycle.enter(repo, args.task)
            elif args.command == "clean":
                result = lifecycle.clean(repo, args.task, args.check)
            else:
                result = lifecycle.list_worktrees(repo)
                total = len(result["worktrees"])
                if not args.all:
                    result["worktrees"] = result["worktrees"][:50]
                result.update(total=total, omitted=total - len(result["worktrees"]))
        sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n" if args.json else render(result))
        if "results" in result and any("reason" in item for item in result["results"]):
            return 1
        return 0
    except (WtError, OSError, ValueError) as error:
        print(f"wt: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("wt: Interrupted. Inspect wt list before retrying; no automatic rollback was attempted.", file=sys.stderr)
        return 130
