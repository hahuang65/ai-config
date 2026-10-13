#[path = "support/configuration.rs"]
mod fixture;
#[path = "support/legacy.rs"]
mod legacy;
use evaluation::configuration::{LegacyLink, switch_configuration};
use fixture::{CLAUDE_SETTINGS as CLAUDE, OBSOLETE, PI_SETTINGS as PI, put, settings};
use legacy::{LegacyFixture, ORIGINAL, PI_ORIGINAL};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

#[test]
fn adopts_only_declared_legacy_resources_and_detaches_settings_without_changing_the_source() {
    let setup = LegacyFixture::new();
    let fixture = &setup.fixture;
    let independent = fixture.base.join("typesafe/SKILL.md");
    put(&independent, "independent resource");
    symlink(&independent, fixture.home.join(".pi/agent/skills/typesafe")).unwrap();
    put(
        setup.next.source.join(".state/pi/sentinel"),
        "retained evaluation state",
    );
    assert!(switch_configuration(&fixture.home, &setup.next).is_err());
    setup.adopt().unwrap();
    fixture.assert_source(&setup.next);
    assert!(
        fs::symlink_metadata(fixture.home.join(CLAUDE))
            .unwrap()
            .is_file()
    );
    assert_eq!(
        settings(fixture, CLAUDE),
        serde_json::json!({"theme":"new-theme","model":"saved-model","permissions":{"allow":["Read(personal/**)","Read(new/**)"]}})
    );
    assert_eq!(settings(fixture, PI)["defaultModel"], "saved-model");
    assert_eq!(
        fs::read_to_string(&setup.source_settings).unwrap(),
        ORIGINAL
    );
    assert_eq!(
        fs::read_link(fixture.home.join(".pi/agent/skills/typesafe")).unwrap(),
        independent
    );
    fixture.install(&setup.next);
    fixture.install(&setup.old);
    fixture.assert_source(&setup.old);
    assert!(
        fs::symlink_metadata(fixture.home.join(CLAUDE))
            .unwrap()
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(&setup.source_settings).unwrap(),
        ORIGINAL
    );
    assert_eq!(
        fs::read_to_string(setup.next.source.join(".state/pi/sentinel")).unwrap(),
        "retained evaluation state"
    );
}

#[test]
fn detaches_a_declared_settings_link_even_when_no_settings_values_change() {
    let mut setup = LegacyFixture::new();
    setup.next = setup.old.clone();
    fs::set_permissions(&setup.source_settings, fs::Permissions::from_mode(0o640)).unwrap();
    setup.adopt().unwrap();
    assert_eq!(
        fs::read_to_string(setup.fixture.home.join(CLAUDE)).unwrap(),
        ORIGINAL
    );
    assert_eq!(
        fs::metadata(setup.fixture.home.join(CLAUDE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(&setup.source_settings)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o640
    );
    assert_eq!(
        fs::read_to_string(&setup.source_settings).unwrap(),
        ORIGINAL
    );
}

#[test]
fn detaches_either_native_settings_link_without_any_managed_setting_fields() {
    for (destination, content) in [(CLAUDE, ORIGINAL), (PI, PI_ORIGINAL)] {
        let mut setup = LegacyFixture::new();
        let source = setup.old.source.join("linked-settings.json");
        put(&source, content);
        let path = setup.fixture.home.join(destination);
        fs::remove_file(&path).unwrap();
        symlink(&source, &path).unwrap();
        setup.legacy.settings.clear();
        setup.next.settings.clear();
        setup.legacy.settings_links = vec![LegacyLink {
            destination: destination.into(),
            target: source.clone(),
        }];
        setup.adopt().unwrap();
        assert!(fs::symlink_metadata(&path).unwrap().is_file());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read_to_string(source).unwrap(), content);
    }
}

#[test]
fn accepts_regular_settings_and_absent_legacy_resources_without_creating_a_legacy_record() {
    let setup = LegacyFixture::new();
    fs::remove_file(setup.fixture.home.join(CLAUDE)).unwrap();
    put(setup.fixture.home.join(CLAUDE), ORIGINAL);
    fs::remove_file(setup.fixture.home.join(OBSOLETE)).unwrap();
    setup.adopt().unwrap();
    setup.fixture.assert_source(&setup.next);
    assert!(
        !String::from_utf8(setup.fixture.record())
            .unwrap()
            .contains("saved-model")
    );
    assert!(setup.adopt().is_err());
    setup.fixture.install(&setup.next);
}

#[test]
fn does_not_import_preferences_from_an_uninstalled_legacy_settings_source() {
    let setup = LegacyFixture::new();
    for link in &setup.legacy.links {
        fs::remove_file(setup.fixture.home.join(&link.destination)).unwrap();
    }
    fs::remove_file(setup.fixture.home.join(CLAUDE)).unwrap();
    fs::remove_file(setup.fixture.home.join(PI)).unwrap();
    setup.adopt().unwrap();
    setup.fixture.assert_source(&setup.next);
    assert!(settings(&setup.fixture, CLAUDE).get("model").is_none());
    assert!(settings(&setup.fixture, PI).get("defaultModel").is_none());
    assert_eq!(
        fs::read_to_string(&setup.source_settings).unwrap(),
        ORIGINAL
    );
}

#[test]
fn removes_explicit_upstream_and_dangling_links_without_claiming_unlisted_neighbors() {
    let mut setup = LegacyFixture::new();
    for (destination, target) in [
        (
            ".pi/agent/extensions/old-upstream.ts",
            setup.fixture.base.join("upstream/index.ts"),
        ),
        (
            ".local/bin/old-command",
            setup.old.source.join("removed-command"),
        ),
    ] {
        let path = setup.fixture.home.join(destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        symlink(&target, path).unwrap();
        setup.legacy.links.push(LegacyLink {
            destination: destination.into(),
            target,
        });
    }
    let unlisted = setup.fixture.home.join(".pi/agent/extensions/unlisted.ts");
    symlink(setup.old.source.join("unlisted.ts"), &unlisted).unwrap();
    setup.adopt().unwrap();
    assert!(
        setup
            .fixture
            .home
            .join(".pi/agent/extensions/old-upstream.ts")
            .symlink_metadata()
            .is_err()
    );
    assert!(
        setup
            .fixture
            .home
            .join(".local/bin/old-command")
            .symlink_metadata()
            .is_err()
    );
    assert_eq!(
        fs::read_link(unlisted).unwrap(),
        setup.old.source.join("unlisted.ts")
    );
}
