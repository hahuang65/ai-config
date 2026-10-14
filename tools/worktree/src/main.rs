mod args;
mod cli;
mod git;
mod github;
mod lifecycle;
mod process;
mod records;
mod repository;
mod sessions;
mod text;

use std::fmt;

#[derive(Debug)]
pub enum Error {
    Operational(String),
    Io(std::io::Error),
}
pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn new(message: impl Into<String>) -> Self {
        Self::Operational(message.into())
    }
}
impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Operational(message) => message.fmt(formatter),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

fn main() {
    let code = match cli::main() {
        Ok(code) => code,
        Err(error) => {
            if process::interrupted() {
                eprintln!(
                    "{name}: Interrupted. Inspect {name} list before retrying; no automatic rollback was attempted.",
                    name = args::program_name()
                );
                130
            } else {
                text::diagnostic(&format!("{}: {error}", args::program_name()));
                1
            }
        }
    };
    std::process::exit(code);
}
