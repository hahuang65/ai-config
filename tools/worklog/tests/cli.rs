mod support;

#[path = "cases/lifecycle.rs"]
mod lifecycle;
#[path = "cases/projects.rs"]
mod projects;
#[path = "cases/querying.rs"]
mod querying;
#[path = "cases/storage.rs"]
mod storage;

fn rows(value: &serde_json::Value) -> &Vec<serde_json::Value> {
    value["items"].as_array().unwrap()
}
