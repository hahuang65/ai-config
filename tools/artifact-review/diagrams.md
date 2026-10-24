# Bundled diagram authoring

Pele 1.8.0 is pinned in `package.json` and `bun.lock` and embedded in the Rust binary by `make build`.
The embedded module retains Pele's full license notice.
Generation uses the configured Node, without a browser, global Pele installation, runtime downloads, or node_modules directory.
Neither `open` nor the review server executes the engine.

```sh
./tools/artifact-review/target/release/review-artifact render-diagram /absolute/workflow.mmd \
  --id-prefix workflow > /absolute/workflow.svg
```

The input is a UTF-8 regular file containing Pele-compatible Mermaid syntax, not JavaScript.
SVG goes to stdout only after successful rendering; failures return a concise error without echoing source contents.
Input is capped at 256 KiB, output at 25 MiB, and the Node subprocess at 30 seconds, including blocked input transfer.
Nonblocking input and output share one deadline; an early launcher exit does not remove it.
Node discovery excludes source repositories and inherited review exclusions and clears Node startup hooks.
The input file is resolved first; its parent is excluded even when the caller is outside that checkout.
Mise dispatcher shims are skipped without running them; put the already-installed Node executable's directory on PATH.
Links and images are disabled during generation; the review sanitizer still checks every embedded SVG.
`render-diagram` never starts a review or creates review state.

Use `--id-prefix UNIQUE` for each diagram in a shared HTML document, and retain visible captions and accessible labels.
`--max-width PIXELS` supplies available layout width (1–4096), not a guarantee that every diagram fits or keeps every chart category visible.
Chart-specific dimensions and orientation can be set through Pele-compatible Mermaid configuration in the source.
Prefer horizontal charts or natural-size scrolling when narrowing a diagram would hide categories or shrink labels.
Embed the resulting SVG inline in the HTML before `open`; document JavaScript and external resources remain disabled.

See [the helper README](README.md) for building, review commands, and approval boundaries.
