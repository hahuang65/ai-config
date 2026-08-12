import { describe, expect, test } from "bun:test";

import { evaluateReviewChangeToolCall } from "../harnesses/pi/extensions/review-change-guard.ts";

const outerContext = { active: true, root: "/repo", tempRoot: "/tmp" };

describe("Review change CLI guard", () => {
  test("does nothing outside an active CLI gate", () => {
    expect(evaluateReviewChangeToolCall(
      { toolName: "write", input: { path: "/repo/app.ts" } },
      { ...outerContext, active: false },
    )).toBeNull();
  });

  test("blocks repository and external writes but allows temporary reports", () => {
    expect(evaluateReviewChangeToolCall(
      { toolName: "write", input: { path: "/repo/app.ts" } },
      outerContext,
    )?.reason).toContain("read-only workspace");
    expect(evaluateReviewChangeToolCall(
      { toolName: "write", input: { path: "README.md" } },
      outerContext,
    )?.reason).toContain("read-only workspace");
    expect(evaluateReviewChangeToolCall(
      { toolName: "write", input: { path: "/source-repository/app.ts" } },
      outerContext,
    )?.reason).toContain("temporary report directory");
    expect(evaluateReviewChangeToolCall(
      { toolName: "write", input: { path: "/tmp/review-change-report.html" } },
      outerContext,
    )).toBeNull();
  });

  test("blocks every structured repository write", () => {
    expect(evaluateReviewChangeToolCall(
      { toolName: "edit", input: { path: "/repo/app.ts" } },
      outerContext,
    )?.reason).toContain("read-only workspace");
  });

  test("blocks Git delivery mutations in every gate role", () => {
    for (const command of [
      "git add app.ts",
      "git -C /repo commit -m change",
      "git -c core.fileMode=false add app.ts",
      "FOO=1 git commit -m change",
      "git status\ngit add app.ts",
      "command -p git add app.ts",
      "env -C /tmp git add app.ts",
      "git branch -D old-branch",
      "git remote set-url --push origin git@github.com:acme/app.git",
      "/usr/bin/git push origin HEAD",
      "git rebase main",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("Git delivery mutation");
    }
    for (const command of [
      "git diff -- app.ts",
      "git branch --show-current",
      "git config --get remote.origin.url",
      "git remote get-url origin",
      "git worktree list",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )).toBeNull();
    }
  });

  test("keeps worktree lifecycle mutations in the parent process", () => {
    for (const command of [
      "git worktree add --detach /reviews/head abc123",
      "git -C /repo worktree remove /reviews/head",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("Git delivery mutation");
    }
    expect(evaluateReviewChangeToolCall(
      { toolName: "bash", input: { command: "git worktree list" } },
      outerContext,
    )).toBeNull();
  });

  test("blocks file output from nominally read-only Git commands", () => {
    for (const command of [
      "git diff --output=/repo/changed.patch HEAD",
      "git show --output /source-repository/commit.txt HEAD",
      "git log --output=/tmp/history.txt --oneline",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("Git delivery mutation");
    }
  });

  test("blocks provider mutations while allowing read-only metadata", () => {
    for (const command of [
      "gh pr review 12 --approve",
      "command -- gh pr review 12 --approve",
      "env GH_HOST=github.com gh pr comment 12 --body done",
      "gh api -X POST repos/acme/app/issues",
      "gh api --method=POST repos/acme/app/issues",
      "curl -X POST https://api.github.com/repos/acme/app/issues",
      "curl -XPOST https://api.github.com/repos/acme/app/issues",
      "curl --request=DELETE https://api.github.com/repos/acme/app/issues/1",
      "curl -T payload.json https://api.github.com/repos/acme/app/releases/assets",
      "curl -o response.json https://api.github.com/repos/acme/app",
      "curl -so response.json https://api.github.com/repos/acme/app",
      "curl --config request.cfg",
      "http --check-status POST https://api.github.com/repos/acme/app/issues",
      "glab mr merge 12",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("provider mutation");
    }
    expect(evaluateReviewChangeToolCall(
      { toolName: "bash", input: { command: "gh pr view 12 --json title,body" } },
      outerContext,
    )).toBeNull();
  });

  test("blocks common direct shell mutation in the isolated workspace", () => {
    for (const command of [
      "sed -i '' 's/a/b/' app.ts",
      "rsync /tmp/replacement app.ts",
      "ln -s /tmp/replacement app.ts",
      "dd if=/tmp/replacement of=app.ts",
      "zip output.zip app.ts",
      "node --no-warnings -e 'writeFileSync(\"app.ts\", \"x\")'",
      "node --eval='writeFileSync(\"app.ts\", \"x\")'",
      "python -I -c 'open(\"app.ts\", \"w\")'",
      "perl -e 'print 1'",
      "bash --noprofile -c 'touch app.ts'",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("read-only workspace");
    }
    expect(evaluateReviewChangeToolCall(
      { toolName: "bash", input: { command: "curl https://example.invalid > tracked.txt" } },
      outerContext,
    )?.reason).toContain("output redirection");
    for (const command of [
      "cat $(touch tracked.txt)",
      "cat <(touch tracked.txt)",
      "cat 'x\\' <(touch tracked.txt)",
      "cat 'x\\' >(touch tracked.txt)",
      "cat x\\' <(touch tracked.txt)",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("command substitution");
    }
    for (const command of [
      "sort -o tracked.txt input.txt",
      "sort -otracked.txt input.txt",
      "sort -rotracked.txt input.txt",
      "sort --output=tracked.txt input.txt",
      "find . -fls tracked.txt",
      "find . -fprint tracked.txt",
    ]) {
      expect(evaluateReviewChangeToolCall(
        { toolName: "bash", input: { command } },
        outerContext,
      )?.reason).toContain("unsupported shell command");
    }
    expect(evaluateReviewChangeToolCall(
      { toolName: "bash", input: { command: "find . -name '*.ts' -print" } },
      outerContext,
    )).toBeNull();
    expect(evaluateReviewChangeToolCall(
      { toolName: "bash", input: { command: "./write-files.sh" } },
      outerContext,
    )?.reason).toContain("unsupported shell command");
    expect(evaluateReviewChangeToolCall(
      { toolName: "bash", input: { command: "make test" } },
      outerContext,
    )).toBeNull();
  });
});
