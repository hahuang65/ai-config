export function createBrowserReloadController({ compare, navigate, present }) {
  const lifecycle = createReloadLifecycleCoordinator();
  function accept(event) {
    for (const action of lifecycle.accept(event)) {
      if (action.type === "navigate-frame") navigate(action.generation);
      if (new Set(["clear-comparison-presentation", "present-comparison", "present-comparison-status"])
        .has(action.type)) present(action);
      if (action.type === "compare-revisions") finishComparisonAction(action);
    }
  }
  function finishComparisonAction(action) {
    try {
      const regions = compare(action.previousRevision, action.currentRevision);
      accept({
        type: "comparison-finished",
        comparisonId: action.comparisonId,
        generation: action.generation,
        regions,
      });
    } catch (error) {
      accept({
        type: "comparison-failed",
        comparisonId: action.comparisonId,
        generation: action.generation,
        status: error?.name === "ArtifactRevisionLimitError" ? "limited" : "unavailable",
      });
    }
  }
  return Object.freeze({ accept });
}

export function createReloadLifecycleCoordinator() {
  const state = {
    activeComparisonId: 0,
    baseline: null,
    comparisonRevision: null,
    generation: 0,
    loading: false,
    nextComparisonId: 1,
    pendingReload: false,
    statusComparisonId: 0,
    statusVisible: false,
  };
  return Object.freeze({ accept: (event) => reduceLifecycle(state, event) });
}

function reduceLifecycle(state, event) {
  if (event.type === "reload-requested") return requestReload(state);
  if (event.type === "frame-settled") return settleFrame(state, event);
  if (event.type === "frame-failed") return failFrame(state, event);
  if (event.type === "comparison-finished") return finishComparison(state, event);
  if (event.type === "comparison-failed") return failComparison(state, event);
  return [];
}

function requestReload(state) {
  if (state.loading) {
    state.pendingReload = true;
    return [];
  }
  state.loading = true;
  state.generation += 1;
  return [{ type: "navigate-frame", generation: state.generation }];
}

function settleFrame(state, event) {
  if (event.generation !== state.generation) return [];
  if (!state.baseline) {
    state.baseline = event.revision;
    state.loading = false;
    if (!state.statusVisible) return [];
    state.statusVisible = false;
    return [{
      type: "clear-comparison-presentation",
      comparisonId: state.statusComparisonId,
      generation: event.generation,
    }];
  }
  if (state.pendingReload) {
    state.pendingReload = false;
    state.generation += 1;
    return [{ type: "navigate-frame", generation: state.generation }];
  }
  state.loading = false;
  const comparisonId = state.nextComparisonId++;
  state.activeComparisonId = comparisonId;
  state.comparisonRevision = event.revision;
  return [{
    type: "compare-revisions",
    comparisonId,
    generation: state.generation,
    previousRevision: state.baseline,
    currentRevision: event.revision,
  }];
}

function failFrame(state, event) {
  if (event.generation !== state.generation) return [];
  if (state.pendingReload) {
    state.pendingReload = false;
    state.generation += 1;
    return [{ type: "navigate-frame", generation: state.generation }];
  }
  state.loading = false;
  state.activeComparisonId = 0;
  state.baseline = null;
  state.comparisonRevision = null;
  state.statusComparisonId = state.nextComparisonId++;
  state.statusVisible = true;
  return [{
    type: "present-comparison-status",
    comparisonId: state.statusComparisonId,
    generation: event.generation,
    status: event.status,
  }];
}

function failComparison(state, event) {
  if (event.generation !== state.generation || event.comparisonId !== state.activeComparisonId) return [];
  state.activeComparisonId = 0;
  state.baseline = null;
  state.comparisonRevision = null;
  state.statusComparisonId = event.comparisonId;
  state.statusVisible = true;
  return [{
    type: "present-comparison-status",
    comparisonId: event.comparisonId,
    generation: event.generation,
    status: event.status,
  }];
}

function finishComparison(state, event) {
  if (event.generation !== state.generation || event.comparisonId !== state.activeComparisonId) return [];
  state.baseline = state.comparisonRevision;
  state.comparisonRevision = null;
  state.statusVisible = false;
  state.activeComparisonId = 0;
  return [{
    type: "present-comparison",
    comparisonId: event.comparisonId,
    generation: event.generation,
    regions: event.regions,
  }];
}
