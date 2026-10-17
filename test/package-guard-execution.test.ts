import { test } from "bun:test";
import { expectBlocked } from "./fixtures/guard-commands";

test("group and literal-shell output redirections retain per-file write protection", async () => {
  for (const command of ["(printf config) >settings.json", "{ echo config; } >settings.json",
    "bash -c 'printf config' >settings.json", "(printf config >/dev/null) >settings.json", "(printf config) &>>settings.json"]) {
    await expectBlocked(command, true);
  }
  for (const command of ["(printf config) >/dev/null", "{ echo config; } >/dev/null",
    "printf '%s' '(printf config) >settings.json'"]) {
    await expectBlocked(command, false);
  }
});

test("Node required option values do not hide inline programs or absorb real script operands", async () => {
  for (const option of ["--title guard-test", "--stack-trace-limit 10", "--dns-result-order ipv4first", "--max-old-space-size 64"]) {
    await expectBlocked(`node ${option} -e 'require("fs").readFileSync("/home/disposable-user/.review-publication/signing-key")'`, true);
    await expectBlocked(`node ${option} -e 'console.log(1)'`, false);
    await expectBlocked(`node ${option} local.js -e 'require("fs").writeFileSync("page.html", "changed")'`, false);
  }
});

test("recursive diff protects private-state ancestors while allowing project comparisons", async () => {
  for (const command of ['diff -rN "$HOME" /tmp/empty', 'diff --recursive "$HOME/.claude" /tmp/empty']) {
    await expectBlocked(command, true);
  }
  for (const command of ["diff -rN ./src ./backup", "printf '%s' 'diff -rN $HOME /tmp/empty'"]) {
    await expectBlocked(command, false);
  }
});
