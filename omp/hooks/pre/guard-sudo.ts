// guard-sudo.ts
//
// Pre-hook: blocks any invocation of `sudo`. Replaces the deleted
// rules/no-sudo.md.
//
// The match pattern is `\bsudo\s` (sudo as a word followed by whitespace —
// the actual command-invocation shape). This catches all wrapper variants
// because they all contain the literal substring "sudo " somewhere in the
// command being sent to bash:
//
//   sudo apt                              → matches at start
//   bash <(sudo apt)                      → matches inside process subst
//   find … -exec sudo rm {} \;            → matches after -exec
//   python -c "os.system('sudo apt')"     → matches inside the -c string
//   pseudo-random                          → does NOT match (no word boundary)
//   sudoers                                → does NOT match
//   cat sudo.txt                           → does NOT match (no space after)
//   /usr/local/bin/sudo                    → does NOT match (no space after)
//
// See docs/adr/0006 for the migration rationale. The hook layer is chosen
// here for consistency with the other migrated guards rather than to fix a
// specific regex bypass — the prior TTSR rule's `scope: tool:bash` already
// prevented prose over-firing.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const SUDO_PATTERN = /\bsudo\s/;

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");
    if (SUDO_PATTERN.test(cmd)) {
      return {
        block: true,
        reason: `Refused — sudo invocation: ${cmd.slice(0, 80)}${cmd.length > 80 ? "…" : ""}`,
      };
    }
  });
}
