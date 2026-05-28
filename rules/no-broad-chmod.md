---
description: Block recursive chmod of root/home/system paths or wildcards — silently locks out access without deleting.
condition:
  - '\bchmod\s+-[a-zA-Z]*[Rr][a-zA-Z]*\s+\S+\s+(/|~|\$HOME|/etc|/usr|/var|/opt|/Users|/home)(\s|/|$)'
  - '\bchmod\s+-[a-zA-Z]*[Rr][a-zA-Z]*\s+\S+\s+\*(\s|$)'
scope: tool:bash
---

# No broad recursive chmod

You were about to run `chmod -R` against a root, home, or system path (`/`, `~`, `$HOME`, `/etc`, `/usr`, `/var`, `/opt`, `/Users`, `/home`) or a `*` wildcard. Stop.

Recursive permission changes on broad targets are equivalent in damage to `rm -rf` — `chmod -R 000 ~` locks the user out of their own home directory; `chmod -R 777 /etc` opens system config files to write by anyone. Neither deletes data, but both can render the system unusable until the permissions are restored. There is no automated undo (you'd have to re-walk the tree).

Right approach:

- Delete specific named paths: `chmod -R 755 path/to/specific/dir`
- Never use a wildcard, `/`, `~`, `$HOME`, or a system directory as the target of a recursive chmod
- If the goal is to fix a specific permission problem, identify the exact file(s) first with `find ... -perm ...` and chmod each by name

Re-plan with explicit named targets, then proceed.
