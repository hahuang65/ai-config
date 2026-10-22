# Diagram renderer evaluation

**PROTOTYPE — NOT PRODUCTION.**
This experiment records rendering and review compatibility at starting commit `1ddac3578d491a0fc4bb6a1e81d4a828eb3bddc8`.
Its original review-compatibility expectations describe that baseline, not the later static SVG implementation in this task.
Re-running the prototype against the changed helper can therefore fail the old SVG-stripping characterization as well as the category-retention probe.
It is not a production compatibility gate and does not install a renderer.

## Run

Prerequisites are the existing Node 25 toolchain, Firefox, a compiled debug review-artifact binary, and an isolated output directory.
Build the binary with `cargo build --locked --manifest-path tools/artifact-review/Cargo.toml`.
Do not install or upgrade tools as a test side effect.

The output directory must contain the two browser bundles listed in `packages.lock.json` as `pele.js` and `mermaid.js`.
Download only the exact listed package tarballs after permission, verify each archive's SHA-512 integrity, and extract only its listed regular-file member.
The comparison verifies the extracted bundle sizes and SHA-256 checksums before executing them.
No package lifecycle scripts run.
The original evaluation used `/tmp/pele-evaluation.gNR5XW`.

Run the comparison from the task worktree:

```sh
PELE_EVAL_ROOT=/tmp/pele-evaluation.gNR5XW node --test --test-concurrency=1 tools/artifact-review/tests/pele-evaluation/compare.mjs
```

The command has a nonzero exit status when a renderer loses required labels.
It still saves all completed baseline and tuned results, images, and reports for inspection.
The separate capability probe also remains intentionally red while the review runtime strips SVG:

```sh
PELE_EVAL_ROOT=/tmp/pele-evaluation.gNR5XW node --test tools/artifact-review/tests/pele-evaluation/capability.mjs
```

Both commands are explicit experiment entry points, not additions to `make test`.
The bounded Firefox suite uses one browser process and serial isolated cases.
Test timeouts stop the browser process group, and teardown closes the loopback fixture server.
No manual stop command is required.
The tests retain their evidence and isolated review state instead of deleting the experiment.

## Evidence

- `results.json`: 32 baseline renders: four fixtures, two widths, two themes, and two libraries.
- `tuned.json`: four narrow-chart experiments with explicit dimensions and optional horizontal orientation.
- `environment.json`: observed browser identity and test widths.
- `packages.json`: downloaded package identities, registry integrity strings, and extracted bundle checksums.
- `comparison.html`: self-contained raster comparison suitable for the unchanged review runtime.
- `vectors.html`: script-free inline SVG comparison for ordinary browser inspection only.
- `sanitized-comparison.html`: the real review sanitizer's output, checked in Firefox for image decoding and narrow-page overflow.

The baseline comparison uses identical synthetic Mermaid sources, Arial, and matched theme colors and chart palettes.
It measures effective SVG text size after scaling, diagram dimensions, clipped text, and intersecting text bounding boxes.
The measurements happen in 1040-pixel and 380-pixel containers, not in the later gallery cards.
The PNGs use twice the measured display resolution.
Computed colors and font styles are copied before SVG-to-PNG conversion so parent CSS variables do not disappear.

The tests confirm required source labels and absence of generated script, image, link, and foreignObject elements in these fixtures.
They do not establish safe handling of arbitrary input or full SVG sanitizer requirements.
Unused Mermaid animation CSS can still appear in its generated SVG.

## Observed answer

Pele improves narrow workflow and sequence text size compared with default Mermaid scaling, but neither automatically makes the dense examples comfortably readable.
At 380 pixels wide, the smallest workflow text measures 7.68 pixels in Pele and 3.75 pixels in Mermaid.
Sequence text measures 9.93 pixels and 6.19 pixels respectively.
The domain diagram difference is small: 10.36 pixels versus 9.91 pixels.
At wide widths, Mermaid has larger minimum text in the workflow, sequence, and domain fixtures.
No baseline fixture has text outside its SVG rectangle or overlapping text bounding boxes.
This does not prove good connector routing or absence of other visual collisions.

Pele's narrow vertical chart omits the Validation and Publication categories in both themes.
The label-retention assertion therefore fails, and the failure is retained rather than converted to a passing expectation.
Explicit narrow dimensions let Mermaid retain every chart category at 14 pixels.
A horizontal chart lets both libraries retain every category at 14 pixels.
Pele keeps skipping two categories in the explicitly sized vertical variant.

Both libraries' inline SVG disappears under the current review sanitizer.
Their PNG output survives.
The comparison report's 20 PNGs decode after real review sanitization, with no document scripts or SVG retained.
Runtime Mermaid scripts are removed too.

The useful next direction is pre-rendered static SVG plus an explicit readability policy, not executing diagram libraries inside approval documents.
Natural-size scrolling, simpler diagrams, and chart orientation can matter more than the renderer.
Pele is a useful candidate, not a universal replacement established by these fixtures.
No actual authoring-time savings, production compatibility, accessibility completeness, or cross-browser parity have been measured.
The user approved the visual comparison and strongly preferred Pele's appearance.
Production integration and its security checks remain separate from that aesthetic decision.
