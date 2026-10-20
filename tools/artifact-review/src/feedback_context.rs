use crate::{model::Event, paths::Result, store::Store};
use serde_json::{Value, json};

impl Store {
    pub(crate) fn feedback_context(&self, current: &Event) -> Result<Value> {
        let mut context =
            serde_json::to_value(current).map_err(|_| "Cannot encode saved feedback.")?;
        let mut size = context.to_string().len() + 128;
        if size > 128 * 1024 {
            return Err("Saved feedback exceeds the response context limit.");
        }
        let mut statement = self.0.prepare("SELECT cursor,payload FROM events WHERE cursor<>?1 AND (cursor<?1 OR action='reply') ORDER BY cursor DESC LIMIT 51")
            .map_err(|_| "Cannot read saved discussion.")?;
        let rows = statement
            .query_map([current.cursor as i64], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| "Cannot read saved discussion.")?;
        let mut events = vec![];
        let mut truncated = false;
        for row in rows {
            let (cursor, payload) = row.map_err(|_| "Cannot read saved discussion.")?;
            let submission =
                serde_json::from_str(&payload).map_err(|_| "Invalid saved discussion.")?;
            let event = serde_json::to_value(Event {
                cursor: cursor as u64,
                submission,
            })
            .map_err(|_| "Cannot encode saved discussion.")?;
            size += event.to_string().len() + 1;
            if events.len() == 50 || size > 128 * 1024 {
                truncated = true;
                break;
            }
            events.push(event);
        }
        events.reverse();
        context["prior_events"] = json!(events);
        context["history_truncated"] = json!(truncated);
        Ok(context)
    }
}
