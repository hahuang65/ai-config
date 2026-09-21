import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SQL_PATH = fileURLToPath(new URL("../../summarize-work/references/work-log.sql", import.meta.url));

function containsCheckpoint(directory) {
  const root = path.join(directory, "events");
  if (!existsSync(root)) return false;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) return true;
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
    }
  }
  return false;
}

export function queryWorkLog(directory, sql) {
  if (!containsCheckpoint(directory)) return [];
  const invocation = spawnSync("duckdb", ["-json", "-init", SQL_PATH, "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, WORK_LOG_DIR: directory },
    maxBuffer: 50 * 1024 * 1024,
    timeout: 10_000,
  });
  if (invocation.error?.code === "ENOENT") throw new Error("DuckDB is required to query the Work log.");
  if (invocation.error?.code === "ETIMEDOUT") throw new Error("DuckDB query timed out after 10 seconds.");
  if (invocation.status !== 0) throw new Error(invocation.stderr.trim() || "DuckDB query failed.");
  try {
    return JSON.parse(invocation.stdout || "[]");
  } catch {
    throw new Error("DuckDB returned invalid JSON.");
  }
}

export function openWork(directory, limit) {
  const limitClause = Number.isInteger(limit) ? `LIMIT ${limit}` : "";
  return queryWorkLog(directory, `
    SELECT work_item_id, title, state, summary, parent_work_item_id,
           repository_id, repository_origin, branch, due_at,
           created_at, updated_at, next_action, commits, tickets
    FROM work_log_items
    WHERE state IN ('planned', 'active', 'paused')
    ORDER BY work_item_id
    ${limitClause}
  `);
}

export function openWorkPage(directory, limit) {
  const items = openWork(directory, limit);
  const totalCount = queryWorkLog(directory, `
    SELECT count(*)::INTEGER AS total_count
    FROM work_log_items
    WHERE state IN ('planned', 'active', 'paused')
  `)[0]?.total_count ?? 0;
  return {
    items,
    returned_count: items.length,
    total_count: totalCount,
    truncated: items.length < totalCount,
  };
}

export function workItem(directory, workItemId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(workItemId)) {
    throw new Error("work item identifier is invalid.");
  }
  return queryWorkLog(directory, `
    SELECT work_item.*, duration.active_seconds, duration.elapsed_seconds
    FROM work_log_items AS work_item
    JOIN work_log_item_durations AS duration USING (work_item_id)
    WHERE work_item_id = '${workItemId}'
  `)[0];
}

function page(items, totalCount) {
  return {
    items,
    returned_count: items.length,
    total_count: totalCount,
    truncated: items.length < totalCount,
  };
}

export function workItemHistory(directory, workItemId, limit) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(workItemId)) {
    throw new Error("work item identifier is invalid.");
  }
  const limitClause = Number.isInteger(limit) ? `LIMIT ${limit}` : "";
  const where = `work_item_id = '${workItemId}'`;
  const items = queryWorkLog(directory, `
    SELECT * FROM work_log_effective_checkpoints
    WHERE ${where}
    ORDER BY occurred_at, checkpoint_id
    ${limitClause}
  `);
  const totalCount = queryWorkLog(directory, `
    SELECT count(*)::INTEGER AS total_count FROM work_log_effective_checkpoints WHERE ${where}
  `)[0]?.total_count ?? 0;
  return page(items, totalCount);
}

export function timeline(directory, from, to, limit) {
  const limitClause = Number.isInteger(limit) ? `LIMIT ${limit}` : "";
  const where = `CAST(CAST(occurred_at AS TIMESTAMPTZ) AS DATE)
      BETWEEN DATE '${from}' AND DATE '${to}'`;
  const items = queryWorkLog(directory, `
    SELECT * FROM work_log_effective_checkpoints
    WHERE ${where}
    ORDER BY occurred_at, checkpoint_id
    ${limitClause}
  `);
  const totalCount = queryWorkLog(directory, `
    SELECT count(*)::INTEGER AS total_count FROM work_log_effective_checkpoints WHERE ${where}
  `)[0]?.total_count ?? 0;
  return page(items, totalCount);
}

export function periodWork(directory, from, to, limit) {
  const limitClause = Number.isInteger(limit) ? `LIMIT ${limit}` : "";
  const where = `state IN ('completed', 'abandoned')
      AND CAST(updated_at AS DATE) BETWEEN DATE '${from}' AND DATE '${to}'`;
  const items = queryWorkLog(directory, `
    SELECT work_item_id, title, state, summary, repository_id,
           repository_origin, branch, updated_at, commits, tickets
    FROM work_log_items
    WHERE ${where}
    ORDER BY repository_id, work_item_id
    ${limitClause}
  `);
  const totalCount = queryWorkLog(directory, `
    SELECT count(*)::INTEGER AS total_count FROM work_log_items WHERE ${where}
  `)[0]?.total_count ?? 0;
  return page(items, totalCount);
}
