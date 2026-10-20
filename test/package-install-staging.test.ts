import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installerScenarioGuard, installFixture } from "./fixtures/install-script";

type Fixture = ReturnType<typeof installFixture>;
function observeWrites(setup: Fixture) {
  for (const tool of ["ln", "cp"]) {
    const real = tool === "ln" ? "REAL_LN" : "REAL_CP";
    writeFileSync(join(setup.bin, tool), [ '#!/bin/bash',
      'if [[ -f $STAGE_PATH ]]; then',
      '  stage=$(< "$STAGE_PATH"); slot=${!#}',
      '  if [[ ${slot%/*} == "$stage" ]]; then printf touched > "$TOUCHED"; fi',
      'fi', 'exec "$' + real + '" "$@"', '' ].join("\n"), { mode: 0o755 });
  }
}

function substituteStage(setup: Fixture, fault: string) {
  if (fault === "failed metadata") {
    writeFileSync(join(setup.bin, "stat"), [ '#!/bin/bash',
      '"$REAL_STAT" "$@" || exit $?',
      'if [[ -f $STAGE_PATH && ${!#} == "$(< "$STAGE_PATH")" ]]; then exit 7; fi',
      '' ].join("\n"), { mode: 0o755 });
  }
  writeFileSync(join(setup.bin, "mv"), [ '#!/bin/bash',
    'if [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi',
    '"$REAL_MV" "$@" || exit $?',
    'if [[ ${!#} == "$HOME/.pi/agent/AGENTS.md" ]]; then',
    '  slot=${@: -2:1}; stage=${slot%/*}',
    '  printf "%s" "$stage" > "$STAGE_PATH"',
    '  if [[ $FAULT != "failed metadata" ]]; then',
    '    "$REAL_MV" -- "$stage" "$stage.saved" || exit $?',
    '    if [[ $FAULT == directory ]]; then',
    '      mkdir -- "$stage"; printf "foreign sentinel" > "$stage/value-0"',
    '    else "$REAL_LN" -s -- "$FOREIGN" "$stage"; fi',
    '  fi',
    'fi', '' ].join("\n"), { mode: 0o755 });
}

for (const fault of ["directory", "symlink", "failed metadata"]) {
  const reason = fault === "failed metadata" ? "a failed metadata command" : `${fault} substitution`;
  test(`shared staging refuses ${reason} before another write and retains recovery state`, () => {
    const setup = installFixture(), foreign = join(setup.temporary, "foreign");
    try {
      mkdirSync(foreign);
      writeFileSync(join(foreign, "value-0"), "foreign sentinel");
      const stagePath = join(setup.temporary, "stage-path"), touched = join(setup.temporary, "foreign-write");
      observeWrites(setup); substituteStage(setup, fault);
      const result = setup.run([], { REAL_MV: Bun.which("mv")!, REAL_LN: Bun.which("ln")!, REAL_CP: Bun.which("cp")!, REAL_STAT: Bun.which("stat")!,
        FAULT: fault, FOREIGN: foreign, STAGE_PATH: stagePath, TOUCHED: touched });
      expect(existsSync(touched), "must verify staging before another write").toBe(false);
      expect(result.status).toBe(1);
      expect(result.error).toBeUndefined();
      expect(result.stderr).toContain("Staging directory changed during installation");
      expect(readFileSync(join(foreign, "value-0"), "utf8")).toBe("foreign sentinel");
      if (fault === "directory") expect(readFileSync(join(readFileSync(stagePath, "utf8"), "value-0"), "utf8")).toBe("foreign sentinel");
      const lock = join(setup.home, ".local/state/ai-config/install.lock.d");
      const workspace = readFileSync(join(lock, "workspace"), "utf8").trim();
      expect(workspace.startsWith(setup.temporary + "/")).toBe(true);
      expect(statSync(workspace).mode & 0o777).toBe(0o700);
      expect(existsSync(join(workspace, "journal"))).toBe(true);
    } finally { setup.clean(); }
  }, installerScenarioGuard(1));
}

test("staging cleanup preserves unexpected entries and retains its private workspace and blocking lock", () => {
  const setup = installFixture(), entry = join(setup.temporary, "unexpected-entry");
  try {
    writeFileSync(join(setup.bin, "mv"), [ '#!/bin/bash',
      'if [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi',
      '"$REAL_MV" "$@" || exit $?',
      'if [[ ${!#} == "$HOME/.local/state/ai-config/installation.json" ]]; then',
      '  slot=${@: -2:1}; stage=${slot%/*}',
      '  printf "%s" "$stage/unexpected" > "$ENTRY_PATH"',
      '  printf "foreign sentinel" > "$stage/unexpected"',
      'fi', '' ].join("\n"), { mode: 0o755 });
    const result = setup.run([], { REAL_MV: Bun.which("mv")!, ENTRY_PATH: entry });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cleanup incomplete");
    expect(readFileSync(readFileSync(entry, "utf8"), "utf8")).toBe("foreign sentinel");
    const lock = join(setup.home, ".local/state/ai-config/install.lock.d");
    const workspace = readFileSync(join(lock, "workspace"), "utf8").trim();
    expect(workspace.startsWith(setup.temporary + "/")).toBe(true);
    expect(statSync(workspace).mode & 0o777).toBe(0o700);
    expect(existsSync(join(workspace, "journal"))).toBe(true);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(true);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
