import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { LanguageServers } from "./lsp/client";

export default function languageServers(pi: ExtensionAPI) {
  const servers = new LanguageServers(); // No process, timer, or file access until a tool call.
  pi.registerTool({
    name: "lsp", label: "LSP",
    description: "Read-only language-server queries for Python, Ruby, Lua, Go, Shell, Terraform, TypeScript/JavaScript, and Rust. " +
      "Servers start only when called. Paths are relative to the current workspace; positions are 1-based UTF-16. " +
      "Requires the tools declared in mise.toml. No edit/rename/execute-command operations or automatic provisioning. " +
      "Use only in trusted workspaces: servers may load project code. Results use native LSP zero-based ranges.",
    parameters: Type.Object({ operation: Type.Union([Type.Literal("hover"), Type.Literal("definition"),
      Type.Literal("references"), Type.Literal("symbols"), Type.Literal("diagnostics")]), path: Type.String(),
      line: Type.Optional(Type.Integer({ minimum: 1 })), column: Type.Optional(Type.Integer({ minimum: 1 })) }),
    outputSchema: Type.Object({ result: Type.Unknown(), truncated: Type.Boolean(), preview: Type.Optional(Type.String()) }),
    executionMode: "sequential",
    async execute(_id, input, signal, _update, ctx) {
      const result = await servers.execute(ctx.cwd, input, signal);
      const text = JSON.stringify(result ?? null);
      const truncated = Buffer.byteLength(text) > 48_000;
      const visible = truncated ? text.slice(0, 12_000) + "\n[Result truncated; narrow the query.]" : text;
      return { content: [{ type: "text", text: visible }], details: { truncated },
        structuredContent: { result: truncated ? null : result ?? null, truncated, ...(truncated ? { preview: visible } : {}) } };
    },
  });
  pi.on("session_shutdown", () => servers.stop());
}
