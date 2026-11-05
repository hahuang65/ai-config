// One integration binary lets Rust schedule these isolated cases together.
#[path = "cases/branch_validation.rs"]
mod branch_validation;
#[path = "cases/cleanup.rs"]
mod cleanup;
#[path = "cases/completions.rs"]
mod completions;
#[path = "cases/local_links.rs"]
mod local_links;
#[path = "support/repository.rs"]
mod repository;
#[path = "cases/sessions.rs"]
mod sessions;
#[path = "cases/shell.rs"]
mod shell;
