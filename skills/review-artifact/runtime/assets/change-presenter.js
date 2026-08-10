export function createArtifactChangePresenter({ artifact, changeBar }) {
  let activeComparison = { comparisonId: 0, generation: 0 };

  function present(comparison) {
    activeComparison = {
      comparisonId: comparison.comparisonId,
      generation: comparison.generation,
    };
    if (comparison.type === "present-comparison") {
      artifact.contentWindow?.postMessage({
        type: "review:present-changed-regions",
        ...activeComparison,
        regions: comparison.regions,
      }, "*");
    }
    changeBar.present(comparison);
  }

  function presentationFailed(message) {
    if (message.comparisonId !== activeComparison.comparisonId
      || message.generation !== activeComparison.generation) return;
    changeBar.present({ type: "present-comparison-status", status: "unavailable" });
  }

  function activate(direction) {
    artifact.contentWindow?.postMessage({
      type: "review:activate-changed-region",
      ...activeComparison,
      direction,
    }, "*");
  }

  function dismiss() {
    artifact.contentWindow?.postMessage({
      type: "review:dismiss-changed-regions",
      ...activeComparison,
    }, "*");
    changeBar.dismiss();
  }

  return Object.freeze({ activate, dismiss, present, presentationFailed });
}
