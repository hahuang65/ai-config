import { anyInvocation } from "./command-invocations";
import type { ToolCall } from "./guard-core";

const HELP = new Set(["--help", "--version"]);
const POWER_ACTIONS = new Set(["poweroff", "reboot", "halt", "kexec", "suspend", "hibernate", "hybrid-sleep", "suspend-then-hibernate"]);

function unsafeKill(args: string[]): boolean {
  if (args[0] === "-l" || args[0] === "-L") return false;
  const operands = [...args];
  let signal = "TERM";
  if (["-s", "--signal", "-n"].includes(operands[0])) {
    operands.shift();
    signal = operands.shift() ?? "";
  } else if (operands[0]?.startsWith("--signal=")) signal = operands.shift()!.slice(9);
  else if (operands[0]?.startsWith("-") && operands[0] !== "--") signal = operands.shift()!.slice(1);
  if (operands[0] === "--") operands.shift();
  return /^(?:0*9|(?:SIG)?KILL)$/i.test(signal)
    || !/^(?:[A-Z]+|\d+)$/i.test(signal)
    || operands.length === 0 || operands.some((pid) => !/^[1-9]\d*$/.test(pid));
}

export function detectUnsafeTermination(call: ToolCall): string | null {
  const denied = anyInvocation(call.command, ([executable, ...args]) => {
    if (args.length === 1 && HELP.has(args[0])) return false;
    if (["pkill", "killall", "killall5", "xkill"].includes(executable)) return true;
    return executable === "kill" && unsafeKill(args);
  });
  return denied ? "Refused — forced or broad process termination; use a graceful signal with explicit positive PID(s), or ask the user to terminate it manually." : null;
}

export function detectHostShutdown(call: ToolCall): string | null {
  const denied = anyInvocation(call.command, ([executable, ...args]) => {
    if (args.length === 1 && HELP.has(args[0])) return false;
    if (["shutdown", "reboot", "poweroff", "halt"].includes(executable)) return true;
    if (["init", "telinit"].includes(executable)) return args.some((arg) => ["0", "6"].includes(arg));
    return executable === "systemctl" && POWER_ACTIONS.has(args.find((arg) => !arg.startsWith("-")) ?? "");
  });
  return denied ? "Refused — host shutdown, reboot, or sleep interrupts other work; the user must run it manually." : null;
}

function wipefsErases(args: string[]): boolean {
  let destructive = false, noAct = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") break;
    if (arg === "--no-act") noAct = true;
    if (arg === "--all" || arg.startsWith("--offset=")) destructive = true;
    if (["--offset", "--types", "--output"].includes(arg)) {
      destructive ||= arg === "--offset";
      index += 1;
      continue;
    }
    if (!/^-[^-]/.test(arg)) continue;
    for (let position = 1; position < arg.length; position += 1) {
      const flag = arg[position];
      if (flag === "n") noAct = true;
      if (flag === "a" || flag === "o") destructive = true;
      // These options consume the remaining cluster, or their following required value.
      if (["o", "t", "O", "b"].includes(flag)) {
        if (position === arg.length - 1 && flag !== "b") index += 1;
        break;
      }
    }
  }
  return destructive && !noAct;
}

export function detectDiskFormat(call: ToolCall): string | null {
  const denied = anyInvocation(call.command, ([executable, ...args]) => {
    if (args.length === 1 && HELP.has(args[0])) return false;
    if (/^(?:mkfs|newfs)(?:[._].+)?$/.test(executable) || ["mke2fs", "mkswap"].includes(executable)) return true;
    if (executable === "wipefs") return wipefsErases(args);
    if (executable === "sgdisk") return args.some((arg) => /^--(?:zap(?:-all)?|clear|delete|new|load-backup)(?:=|$)/.test(arg)
      || /^-[^-]*[zZodnl]/.test(arg));
    if (executable === "parted") return args.some((arg) => ["mklabel", "mktable", "mkpart", "rm", "resizepart"].includes(arg));
    if (executable !== "diskutil") return false;
    return /^(?:erase|partition|zeroDisk|randomDisk|secureErase)/.test(args[0] ?? "")
      || ["apfs", "coreStorage", "appleRAID"].includes(args[0]) && /^delete/.test(args[1] ?? "");
  });
  return denied ? "Refused — disk formatting or erasure can destroy data; the user must check the device and run it manually." : null;
}
