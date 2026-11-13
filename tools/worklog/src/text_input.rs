use crate::cli::MAX_TEXT_BYTES;
use crate::error::{Error, Result};
use clap::Args;
use std::fs::{self, File};
use std::io::Read;
use std::path::PathBuf;

#[derive(Args)]
#[group(required = true, multiple = false)]
pub struct TextInput {
    /// Literal single-line text
    #[arg(value_name = "TEXT")]
    text: Option<String>,
    /// Read literal UTF-8 text from a regular file instead of a positional argument
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
}

impl TextInput {
    pub fn resolve(&mut self) -> Result<()> {
        if let Some(path) = &self.text_file {
            if !fs::metadata(path).map_err(read_error)?.is_file() {
                return Err(Error::usage("--text-file requires a regular UTF-8 file"));
            }
            let file = File::open(path).map_err(read_error)?;
            if !file.metadata().map_err(read_error)?.is_file() {
                return Err(Error::usage("--text-file requires a regular UTF-8 file"));
            }
            let mut bytes = Vec::new();
            file.take((MAX_TEXT_BYTES + 3) as u64)
                .read_to_end(&mut bytes)
                .map_err(read_error)?;
            let text = String::from_utf8(bytes)
                .map_err(|_| Error::usage("--text-file must contain UTF-8 text"))?;
            self.text = Some(
                text.strip_suffix("\r\n")
                    .or_else(|| text.strip_suffix('\n'))
                    .unwrap_or(&text)
                    .to_owned(),
            );
        }
        Ok(())
    }

    pub fn value(&self) -> Result<&str> {
        self.text
            .as_deref()
            .ok_or_else(|| Error::usage("provide text or --text-file PATH"))
    }
}

fn read_error(_: std::io::Error) -> Error {
    Error {
        code: 1,
        message: "cannot read text file; check its path and permissions",
    }
}
