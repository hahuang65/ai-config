mod actions;
mod cli;
mod error;
mod git;
mod model;
mod output;
mod query;
mod scope;
mod store;

use clap::Parser;
use cli::{Cli, Command};
use error::Result;
use scope::Selection;
use serde_json::{Value, json};
use std::process::ExitCode;
use store::Store;

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli).and_then(|value| output::print(&value, cli.json, cli.command.is_none())) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}: {error}", cli::program_name());
            ExitCode::from(error.code)
        }
    }
}

fn run(cli: &Cli) -> Result<Value> {
    cli.validate()?;
    let store = Store::locate()?;
    let log = store.read()?;
    let command = cli.command();
    let selection = if matches!(command, Command::Projects { .. })
        || (cli.command.is_none() && !cli.scope.is_explicit())
    {
        Selection::All
    } else {
        Selection::resolve(&cli.scope, &log)?
    };
    if command.is_write() {
        let project = selection.project()?;
        let entry = store.append(|log| actions::build(command, project.clone(), log))?;
        return Ok(json!({ "entry": entry }));
    }
    query::run(command, &selection, &log)
}
