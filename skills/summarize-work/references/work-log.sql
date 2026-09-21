CREATE OR REPLACE VIEW work_log_checkpoints AS
SELECT *
FROM read_json_auto(
  getenv('WORK_LOG_DIR') || '/events/**/*.json',
  format = 'unstructured',
  union_by_name = true,
  maximum_object_size = 1048576
);

CREATE OR REPLACE VIEW work_log_effective_checkpoints AS
SELECT checkpoint.*
FROM work_log_checkpoints AS checkpoint
WHERE NOT EXISTS (
  SELECT 1
  FROM work_log_checkpoints AS correction
  WHERE TRY_CAST(correction.corrects_checkpoint_id AS VARCHAR) = CAST(checkpoint.checkpoint_id AS VARCHAR)
);

CREATE OR REPLACE VIEW work_log_items AS
SELECT
  work_item_id,
  arg_max(title, occurred_at || checkpoint_id) FILTER (WHERE title <> '') AS title,
  arg_max(state, occurred_at || checkpoint_id) FILTER (WHERE state IS NOT NULL) AS state,
  arg_max(summary, occurred_at || checkpoint_id) AS summary,
  arg_max(parent_work_item_id, occurred_at || checkpoint_id)
    FILTER (WHERE parent_work_item_id IS NOT NULL) AS parent_work_item_id,
  arg_max(follows_work_item_id, occurred_at || checkpoint_id)
    FILTER (WHERE follows_work_item_id IS NOT NULL) AS follows_work_item_id,
  arg_max(repository_id, occurred_at || checkpoint_id) AS repository_id,
  arg_max(repository_origin, occurred_at || checkpoint_id) AS repository_origin,
  arg_max(branch, occurred_at || checkpoint_id) AS branch,
  arg_max(due_at, occurred_at || checkpoint_id) FILTER (WHERE due_at IS NOT NULL) AS due_at,
  min(CAST(occurred_at AS TIMESTAMPTZ)) AS created_at,
  max(CAST(occurred_at AS TIMESTAMPTZ)) AS updated_at,
  arg_max(next_action, occurred_at || checkpoint_id) FILTER (WHERE next_action <> '') AS next_action,
  arg_max(commits, occurred_at || checkpoint_id) FILTER (WHERE length(commits) > 0) AS commits,
  arg_max(tickets, occurred_at || checkpoint_id) FILTER (WHERE length(tickets) > 0) AS tickets
FROM work_log_effective_checkpoints
GROUP BY work_item_id;

CREATE OR REPLACE VIEW work_log_state_intervals AS
SELECT
  work_item_id,
  state,
  CAST(occurred_at AS TIMESTAMPTZ) AS state_at,
  lead(CAST(occurred_at AS TIMESTAMPTZ)) OVER (
    PARTITION BY work_item_id ORDER BY occurred_at, checkpoint_id
  ) AS next_state_at
FROM work_log_effective_checkpoints
WHERE state IS NOT NULL;

CREATE OR REPLACE VIEW work_log_item_durations AS
SELECT
  work_item.work_item_id,
  CAST(round(sum(
    CASE WHEN interval.state = 'active'
      THEN epoch(coalesce(interval.next_state_at, current_timestamp) - interval.state_at)
      ELSE 0
    END
  )) AS BIGINT) AS active_seconds,
  CAST(round(epoch(
    CASE WHEN work_item.state IN ('completed', 'abandoned')
      THEN work_item.updated_at - work_item.created_at
      ELSE current_timestamp - work_item.created_at
    END
  )) AS BIGINT) AS elapsed_seconds
FROM work_log_items AS work_item
JOIN work_log_state_intervals AS interval USING (work_item_id)
GROUP BY work_item.work_item_id, work_item.state, work_item.created_at, work_item.updated_at;
