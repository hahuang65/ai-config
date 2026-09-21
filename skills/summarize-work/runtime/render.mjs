const MAX_DIGEST_TITLES = 10;

function evidence(workItem) {
  const references = [...(workItem.commits ?? []), ...(workItem.tickets ?? [])];
  return references.length > 0 ? ` (${references.join(", ")})` : "";
}

function digestLine(label, workItems) {
  const visible = workItems.slice(0, MAX_DIGEST_TITLES);
  const omitted = workItems.length - visible.length;
  const suffix = omitted > 0 ? `; ${omitted} more` : "";
  return `${label}: ${visible.map((workItem) => workItem.title).join("; ")}${suffix}`;
}

export function renderSessionDigest(openWorkItems, repositoryId, now = new Date()) {
  const repositoryWork = openWorkItems.filter((workItem) => workItem.repository_id === repositoryId);
  const active = repositoryWork.filter((workItem) => workItem.state === "active");
  const paused = repositoryWork.filter((workItem) => workItem.state === "paused");
  const due = repositoryWork.filter((workItem) => (
    workItem.due_at && new Date(workItem.due_at).valueOf() <= now.valueOf()
  ));
  const dueIds = new Set(due.map((workItem) => workItem.work_item_id));
  const otherPlanned = repositoryWork.filter((workItem) => (
    workItem.state === "planned" && !dueIds.has(workItem.work_item_id)
  ));
  const lines = [`Work log for ${repositoryId}:`];
  if (active.length > 0) lines.push(digestLine("Active", active));
  if (paused.length > 0) lines.push(digestLine("Paused", paused));
  if (due.length > 0) lines.push(digestLine("Due or overdue", due));
  lines.push(`Other planned work: ${otherPlanned.length}`);
  return `${lines.join("\n")}\n`;
}

export function renderPeriodSummary(completedPage, openPage, from, to) {
  const completedWork = completedPage.items;
  const openWorkItems = openPage.items;
  const lines = [`## Work summary: ${from} to ${to}`];
  if (completedPage.truncated) {
    lines.push("", `Showing ${completedPage.returned_count} of ${completedPage.total_count} completed or abandoned items.`);
  }
  const repositories = new Map();
  for (const workItem of completedWork) {
    const group = repositories.get(workItem.repository_id) ?? [];
    group.push(workItem);
    repositories.set(workItem.repository_id, group);
  }
  if (completedWork.length === 0) lines.push("", "No completed or abandoned work was recorded in this period.");
  for (const [repositoryId, workItems] of repositories) {
    lines.push("", `### ${repositoryId}`);
    for (const workItem of workItems) {
      const state = workItem.state === "abandoned" ? " [abandoned]" : "";
      lines.push(`- ${workItem.title}${state} — ${workItem.summary}${evidence(workItem)}`);
    }
  }
  lines.push("", "### Open work");
  if (openPage.truncated) {
    lines.push(`Showing ${openPage.returned_count} of ${openPage.total_count} open items.`);
  }
  if (openWorkItems.length === 0) lines.push("- None.");
  for (const workItem of openWorkItems) {
    const nextAction = workItem.next_action ? ` — Next: ${workItem.next_action}` : "";
    lines.push(`- ${workItem.title} [${workItem.state}]${nextAction}`);
  }
  return `${lines.join("\n")}\n`;
}
