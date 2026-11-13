mod support;

#[path = "cases/fixtures.rs"]
mod fixtures;

#[path = "cases/lifecycle.rs"]
mod lifecycle;
#[path = "cases/projects.rs"]
mod projects;
#[path = "cases/querying.rs"]
mod querying;
#[path = "cases/storage.rs"]
mod storage;
#[path = "cases/text_input.rs"]
mod text_input;

fn rows(value: &serde_json::Value) -> &Vec<serde_json::Value> {
    value["items"].as_array().unwrap()
}
