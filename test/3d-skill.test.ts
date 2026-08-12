import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("3d is a standalone skill discovered by both harnesses", async () => {
  const skill = await source("skills/3d/SKILL.md");
  const commands = await readdir(path.join(REPOSITORY, "commands"));
  const claudeManifest = await source("harnesses/claude/manifest.sh");
  const piManifest = await source("harnesses/pi/manifest.sh");

  expect(skill).toContain("name: 3d");
  expect(skill).toContain("description:");
  expect(skill).toContain("3D-printable");
  expect(commands).not.toContain("3d.md");
  expect(claudeManifest).toContain("consumed_categories=(skills agents)");
  expect(piManifest).toContain("consumed_categories=(skills agents)");
});

test("3d gathers geometry-changing requirements before optional preferences", async () => {
  const workflow = await source("skills/3d/references/workflow.md");
  const purpose = workflow.indexOf("part's purpose");
  const mustFit = workflow.indexOf("must-fit dimension");
  const optional = workflow.indexOf("mounting, printer, material, load, access, and appearance");

  expect(purpose).toBeGreaterThanOrEqual(0);
  expect(mustFit).toBeGreaterThan(purpose);
  expect(optional).toBeGreaterThan(mustFit);
  expect(workflow).toContain("Ask only questions that can change geometry, material, or delivery");
});

test("3d records dimension provenance and resolves conflicts before modeling", async () => {
  const guidance = await source("skills/3d/references/fdm-design.md");

  expect(guidance).toContain("user's direct measurement");
  expect(guidance).toContain("Record the source beside each critical parameter in the model source and model review sheet");
  expect(guidance).toContain("Cite a URL, document title, standard, or “user measurement”");
  expect(guidance).toContain("When sources conflict, report the values and resolve the conflict with the user before geometry depends on one");
  expect(guidance).toContain("Never hide a guess inside fit clearance");
});

test("3d states printer defaults only when more details cannot change geometry", async () => {
  const guidance = await source("skills/3d/references/fdm-design.md");

  expect(guidance).toContain("Ask for printer details only when build volume, nozzle, process accuracy, enclosure, or material capability can change geometry or feasibility");
  expect(guidance).toContain("If those details do not change geometry, state these defaults and continue");
  expect(guidance).toContain("0.4 mm nozzle");
  expect(guidance).toContain("0.20 mm layer height");
  expect(guidance).toContain("- PLA.");
});

test("3d defaults new projects to CadQuery and preserves existing OpenSCAD", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("For a new project, default to CadQuery");
  expect(workflow).toContain("For an existing OpenSCAD project, continue with OpenSCAD");
  expect(workflow).toContain("Do not convert an existing project or silently switch CAD engines after a failure");
});

test("3d follows repository-native project and file naming", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("Follow established repository conventions for the product directory, source basename, multipart suffixes, printable exports, final render, render configuration, and README");
  expect(workflow).toContain("parameterized source");
  expect(workflow).toContain("STL exports for every printable part");
  expect(workflow).toContain("optional STEP exports");
  expect(workflow).toContain("`render.png`");
  expect(workflow).toContain("`README.md`");
});

test("3d always delivers repository-native render evidence with explicit fallbacks", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("Every delivered project must include");
  expect(workflow).toContain("both a final render and its render configuration");
  expect(workflow).toContain("When repository conventions exist, use their names for both files");
  expect(workflow).toContain("When no repository convention exists, name them `render.png` and `render.conf`");
  expect(workflow).not.toMatch(/render configuration (?:only )?(?:when|if)\b/i);
});

test("3d refuses to overwrite an ambiguous existing product directory", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("Reuse an existing directory only when the request clearly continues that product");
  expect(workflow).toContain("When reuse is ambiguous, stop and ask whether to update it or choose another product name");
  expect(workflow).toContain("Never overwrite unrelated work");
});

test("3d stops honestly when required tooling is unavailable", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("Report the missing capability and which planned evidence it blocks");
  expect(workflow).toContain("Propose a setup command compatible with the repository and mise-managed toolchain");
  expect(workflow).toContain("Wait for approval before installing dependencies");
  expect(workflow).toContain("Do not silently install tools, switch engines, skip renders, or describe an unrendered model as validated");
});

test("3d bounds output commands and blocks checkpoints when they time out", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("every model-generation, export, render, and validation command with an explicit bounded timeout");
  expect(workflow).toContain("follows the repository's documented timeout convention and is appropriate for the command's expected workload");
  expect(workflow).toContain("If a timeout expires, report it as an output failure, identify the affected output, and block the affected checkpoint");
});

test("3d uses risk-based checkpoints with an explicit reason for exceptions", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("Use two checkpoints for an ordinary part");
  expect(workflow).toContain("Functional shape");
  expect(workflow).toContain("Final model");
  expect(workflow).toContain("Record the reason for combining or adding checkpoints in the model review sheet");
});

test("3d blocks checkpoints with known output failures until evidence is regenerated", async () => {
  const workflow = await source("skills/3d/references/workflow.md");
  const reviewSheet = await source("skills/3d/references/model-review-sheet.md");

  expect(workflow).toContain("A known generation, export, render, or mesh-integrity failure blocks the checkpoint");
  expect(workflow).toContain("Do not request ordinary final-model approval or deliver the project while a checkpoint is blocked");
  expect(workflow).toContain("Repair the cause, regenerate every affected output and its evidence, and rerun the relevant checks before clearing the blocked status");
  expect(reviewSheet).toContain("Mark the current review status as blocked");
  expect(reviewSheet).toContain("Missing optional evidence may remain “not checked” when it does not prevent validation of the intended output");
});

test("3d model review sheets expose the evidence needed for approval", async () => {
  const reviewSheet = await source("skills/3d/references/model-review-sheet.md");

  for (const requiredContent of [
    "dominant current render",
    "Overall dimensions and critical adjustable parameters",
    "Provenance for must-fit dimensions",
    "Computed validation",
    "Physical validation still required",
    "Proposed material, orientation, supports, walls, infill, layer height, and quantity",
    "Project files that final delivery will retain",
  ]) {
    expect(reviewSheet).toContain(requiredContent);
  }
});

test("3d requires explicit model approval with a browser fallback", async () => {
  const workflow = await source("skills/3d/references/workflow.md");
  const reviewSheet = await source("skills/3d/references/model-review-sheet.md");

  expect(workflow).toContain("Load `review-artifact` and request feedback or approval");
  expect(workflow).toContain("Continue only after explicit approval");
  expect(workflow).toContain("If the browser workflow cannot start, report the fallback and conduct the same review in chat");
  expect(reviewSheet).toContain("update the same HTML so the browser live-reloads current evidence");
  expect(reviewSheet).toContain("A closed browser, ended review, disconnect, or timeout is not approval");
});

test("3d separates computed evidence from physical proof", async () => {
  const guidance = await source("skills/3d/references/fdm-design.md");
  const reviewSheet = await source("skills/3d/references/model-review-sheet.md");

  expect(guidance).toContain("A check that was not run");
  expect(guidance).toContain("not checked");
  expect(guidance).toContain("Computed evidence does not prove");
  expect(guidance).toContain("Fit against the real object");
  expect(guidance).toContain("Strength, fatigue life, impact resistance, or safe working load");
  expect(reviewSheet).toContain("Use “requires test print” for fit, strength, assembly feel, creep, environmental durability, and other physical claims");
});

test("3d recommends proportionate physical tests", async () => {
  const guidance = await source("skills/3d/references/fdm-design.md");

  expect(guidance).toContain("For a tight interface, design a small fit coupon or a cut-down test section before the full print");
  expect(guidance).toContain("For a load-bearing part, print a representative prototype in the intended material and orientation");
  expect(guidance).toContain("before calling it production-ready");
});

test("3d keeps final evidence and removes only workflow-owned temporary review files", async () => {
  const workflow = await source("skills/3d/references/workflow.md");
  const reviewSheet = await source("skills/3d/references/model-review-sheet.md");

  expect(workflow).toContain("Keep the final render and documentation in the product directory");
  expect(workflow).toContain("Delete temporary model review sheets and intermediate checkpoint renders by default");
  expect(workflow).toContain("retain them when the user asks for design history");
  expect(reviewSheet).toContain("remove only temporary sheet files and checkpoint renders created by the current workflow");
  expect(reviewSheet).toContain("Never delete pre-existing files during cleanup");
});

test("3d requires a repository-native README for every product", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("The product README is mandatory");
  expect(workflow).toContain("Follow the structure, headings, link style, image style, and terminology of the nearest comparable product README");
  for (const applicableTopic of [
    "Product summary and final render",
    "Source and export links",
    "Critical dimensions and their provenance",
    "Material and concise slicer settings",
    "Bill of materials or hardware",
    "Assembly and mounting instructions",
    "Adjustable parameters and design rationale",
    "Computed validation and remaining physical-validation limits",
    "Repository license reference",
  ]) {
    expect(workflow).toContain(applicableTopic);
  }
});

test("3d updates an existing root product catalog without inventing one", async () => {
  const workflow = await source("skills/3d/references/workflow.md");

  expect(workflow).toContain("When the repository has a root product catalog, add or update the product entry");
  expect(workflow).toContain("Preserve unrelated catalog content and local style");
  expect(workflow).toContain("When no root product catalog exists, do not create one unless the user asks");
});

test("the library capability catalog lists the standalone 3d workflow", async () => {
  const readme = await source("README.md");

  expect(readme).toContain("| `3d` | Design and review parameterized 3D-printable parts and document each 3D print project. |");
});

test("the library credits the upstream 3d workflow inspiration", async () => {
  const readme = await source("README.md");

  expect(readme).toContain("Nicolas Chourrout");
  expect(readme).toContain("Flowful.ai");
  expect(readme).toContain("https://github.com/flowful-ai/cad-skill");
  expect(readme).toContain("https://medium.com/@nchourrout/i-taught-claude-to-design-3d-printable-parts-heres-how-675f644af78a");
});

test("the 3d acknowledgement states the selective license boundary", async () => {
  const readme = await source("README.md");

  expect(readme).toContain("selective inspiration");
  expect(readme).toContain("original implementation");
  expect(readme).toContain("PolyForm Noncommercial 1.0.0");
  expect(readme).toContain("MIT");
});
