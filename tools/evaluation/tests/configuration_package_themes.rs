#[path = "support/package_fixture.rs"]
mod package_fixture;
#[path = "support/shared_legacy.rs"]
mod shared_legacy;
use evaluation::configuration::{
    adopt_configuration, prepared_manifest, shared_legacy_inventory, switch_configuration,
};
use package_fixture::{fixture, manifest};
use shared_legacy::SharedLegacyFixture;
use std::fs;
use std::path::Path;

#[test]
fn selected_catppuccin_theme_preserves_unrelated_personal_theme_files_and_model() {
    let source = fixture();
    manifest(source.path());
    let desired = prepared_manifest(&source.path().canonicalize().unwrap()).unwrap();
    for theme in [
        ".claude/themes/catppuccin-mocha.json",
        ".pi/agent/themes/catppuccin-mocha.json",
    ] {
        assert!(
            desired
                .links
                .iter()
                .any(|link| link.destination == Path::new(theme)),
            "{theme}"
        );
    }

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
    switch_configuration(&home.path().canonicalize().unwrap(), &desired).unwrap();
    assert_eq!(fs::read(&claude_theme).unwrap(), b"personal theme");
    assert_eq!(fs::read(&pi_theme).unwrap(), b"personal theme");
    let claude: serde_json::Value = serde_json::from_slice(&fs::read(claude).unwrap()).unwrap();
    let pi: serde_json::Value = serde_json::from_slice(&fs::read(pi).unwrap()).unwrap();
    assert_eq!(claude["theme"], "custom:catppuccin-mocha");
    assert_eq!(claude["model"], "saved");
    assert_eq!(pi["theme"], "catppuccin-mocha");
    assert_eq!(pi["defaultProvider"], "saved");
}

#[test]
fn adopting_a_declared_legacy_theme_link_retains_the_selected_theme() {
    let legacy = SharedLegacyFixture::new();
    legacy.install_projection();
    let old_claude = legacy.source.join("harnesses/claude/settings.json");
    let old_settings = fs::read(&old_claude).unwrap();
    let inventory =
        shared_legacy_inventory(&legacy.source, &legacy.upstream, &legacy.agentmemory).unwrap();
    let source = fixture();
    manifest(source.path());
    let desired = prepared_manifest(&source.path().canonicalize().unwrap()).unwrap();
    adopt_configuration(&legacy.home, &desired, &inventory.installation).unwrap();
    assert!(
        legacy
            .home
            .join(".claude/themes/catppuccin-mocha.json")
            .exists()
    );
    assert!(
        legacy
            .home
            .join(".pi/agent/themes/catppuccin-mocha.json")
            .exists()
    );
    assert!(
        legacy
            .home
            .join(Path::new(".claude/skills/commit"))
            .exists()
    );
    assert_eq!(fs::read(&old_claude).unwrap(), old_settings);
}
