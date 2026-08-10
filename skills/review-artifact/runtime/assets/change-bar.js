export function createChangeBar({ bar, count }) {
  function present(presentation) {
    if (presentation.type === "clear-comparison-presentation") {
      dismiss();
      return;
    }
    if (presentation.type === "present-comparison-status") {
      bar.hidden = false;
      bar.dataset.status = presentation.status;
      count.textContent = presentation.status === "limited"
        ? "Detailed highlights are limited"
        : "Change comparison unavailable";
      return;
    }
    delete bar.dataset.status;
    const regionCount = presentation.regions.length;
    bar.hidden = regionCount === 0;
    count.textContent = changeCountLabel(regionCount);
  }

  function dismiss() {
    bar.hidden = true;
    count.textContent = "";
    delete bar.dataset.status;
  }

  return Object.freeze({ dismiss, present });
}

function changeCountLabel(count) {
  if (count === 0) return "";
  return count === 1 ? "1 changed region" : `${count} changed regions`;
}
