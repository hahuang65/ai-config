//! Public Rust installer for the ordinary Claude and Pi package only.
use anyhow::{Context, Result, ensure};
use evaluation::configuration::{prepared_manifest, switch_configuration};
use std::env;
use std::path::PathBuf;

const HELP: &str = "Usage: ai-config --root ABSOLUTE_SOURCE install\nBuild the native package before installation.\nOnly the recorded native resources are changed; no services or trial state are managed.\n";

fn run() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args == ["--help"] || args == ["-h"] {
        print!("{HELP}");
        return Ok(());
    }
    ensure!(
        args.len() == 3 && args[0] == "--root" && args[2] == "install",
        "{HELP}"
    );
    let root = PathBuf::from(&args[1]);
    ensure!(
        root.is_absolute() && root.canonicalize()? == root,
        "Package root must be a canonical absolute directory"
    );
    let home = PathBuf::from(env::var_os("HOME").context("HOME is required")?);
    ensure!(home.is_absolute(), "HOME must be an absolute directory");
    let manifest = prepared_manifest(&root)?;
    switch_configuration(&home, &manifest)?;
    eprintln!("Native Claude and Pi resources installed from the selected package.");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("ai-config: {error}");
        std::process::exit(1);
    }
}
