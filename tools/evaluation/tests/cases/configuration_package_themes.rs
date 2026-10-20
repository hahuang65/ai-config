use crate::support::{
    package_fixture, package_manifest::installed_manifest, shell_install, success,
};
use package_fixture::{fixture, manifest};
use std::fs;
use std::path::Path;

#[test]
fn selected_catppuccin_theme_preserves_unrelated_personal_theme_files_and_model() {
    let source = fixture();
    manifest(source.path());
    let home = tempfile::tempdir().unwrap();
    let claude_theme = home.path().join(".claude/themes/personal.json");
    let pi_theme = home.path().join(".pi/agent/themes/personal.json");
    for path in [&claude_theme, &pi_theme] {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "personal theme").unwrap();
    }
    let claude = home.path().join(".claude/settings.json");
    let pi = home.path().join(".pi/agent/settings.json");
    fs::write(&claude, r#"{"model":"saved"}"#).unwrap();
    fs::write(&pi, r#"{"defaultProvider":"saved"}"#).unwrap();
    success(
        shell_install::command(
            &source.path().canonicalize().unwrap(),
            &home.path().canonicalize().unwrap(),
        )
        .output()
        .unwrap(),
    );
    assert_installed_themes(home.path());
    assert_eq!(fs::read(&claude_theme).unwrap(), b"personal theme");
    assert_eq!(fs::read(&pi_theme).unwrap(), b"personal theme");
    let claude: serde_json::Value = serde_json::from_slice(&fs::read(claude).unwrap()).unwrap();
    let pi: serde_json::Value = serde_json::from_slice(&fs::read(pi).unwrap()).unwrap();
    assert_eq!(claude["theme"], "custom:catppuccin-mocha");
    assert_eq!(claude["model"], "saved");
    assert_eq!(pi["theme"], "catppuccin-mocha");
    assert_eq!(pi["defaultProvider"], "saved");
}

fn assert_installed_themes(home: &Path) {
    let desired = installed_manifest(home).unwrap();
    for (theme, target) in [
        (
            ".claude/themes/catppuccin-mocha.json",
            "harnesses/claude/themes/catppuccin-mocha.json",
        ),
        (
            ".pi/agent/themes/catppuccin-mocha.json",
            "harnesses/pi/themes/catppuccin-mocha.json",
        ),
    ] {
        assert!(
            desired
                .links
                .iter()
                .any(|link| link.destination == Path::new(theme)),
            "{theme}"
        );
        assert_eq!(
            fs::read_link(home.join(theme)).unwrap(),
            desired.source.join(target)
        );
    }
}
