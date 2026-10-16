//! Run the real shell installer in a disposable package; stub compilation only.
use super::executable;
use std::fs;
use std::path::Path;
use std::process::Command;

pub fn resources(source: &Path) {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for relative in [
        "install.sh",
        "tools/install/manifest.jq",
        "tools/install/settings.jq",
        "tools/install/permissions.json",
        "tools/install/lsp-plugin.json",
    ] {
        let destination = source.join(relative);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::copy(repository.join(relative), destination).unwrap();
    }
}

pub fn command(source: &Path, home: &Path) -> Command {
    let bin = home.join(".fixture-build-bin");
    executable(bin.join("make"), "#!/bin/sh\nexit 0\n");
    let scratch = home.join(".fixture-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let mut command = Command::new(source.join("install.sh"));
    command
        .env("HOME", home)
        .env("TMPDIR", scratch)
        .env_remove("BASH_ENV")
        .env_remove("ENV")
        .env(
            "PATH",
            format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
        );
    command
}
