#[path = "support/configuration.rs"]
mod fixture;
#[path = "support/legacy.rs"]
mod legacy;
use evaluation::configuration::{LegacyLink, adopt_configuration};
use fixture::{CLAUDE_SETTINGS as CLAUDE, CLAUDE_SKILL, PI_SETTINGS as PI, RECORD, put};
use legacy::{LegacyFixture, ORIGINAL, PI_ORIGINAL};
use std::fs;
use std::os::unix::fs::symlink;

#[test]
fn refuses_modified_legacy_resource_links_instead_of_claiming_them_by_source_prefix() {
    for suffix in ["skills/selected/", "skills/./selected", "other"] {
        let setup = LegacyFixture::new();
        let changed = setup.old.source.join(suffix);
        fs::remove_file(setup.fixture.home.join(CLAUDE_SKILL)).unwrap();
        symlink(&changed, setup.fixture.home.join(CLAUDE_SKILL)).unwrap();
        assert!(setup.adopt().is_err());
        assert_eq!(
            setup.fixture.target(CLAUDE_SKILL).as_os_str(),
            changed.as_os_str()
        );
        assert_eq!(
            fs::read_to_string(&setup.source_settings).unwrap(),
            ORIGINAL
        );
        assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}

#[test]
fn refuses_unlisted_or_modified_settings_links_without_reading_the_replacement() {
    for kind in ["unlisted", "different", "raw-different"] {
        let mut setup = LegacyFixture::new();
        let path = setup.fixture.home.join(CLAUDE);
        let target = match kind {
            "unlisted" => {
                setup.legacy.settings_links.clear();
                setup.source_settings.clone()
            }
            "different" => setup.fixture.base.join("absent-unrelated-file"),
            "raw-different" => setup.old.source.join("harnesses/claude/./settings.json"),
            _ => unreachable!(),
        };
        fs::remove_file(&path).unwrap();
        symlink(&target, &path).unwrap();
        assert!(setup.adopt().is_err());
        setup.assert_legacy_links();
        assert_eq!(fs::read_link(path).unwrap().as_os_str(), target.as_os_str());
        assert_eq!(
            fs::read_to_string(&setup.source_settings).unwrap(),
            ORIGINAL
        );
        assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}

#[test]
fn rejects_redirected_or_hard_linked_legacy_settings_sources() {
    for kind in ["file-symlink", "parent-symlink", "hardlink"] {
        let setup = LegacyFixture::new();
        let outside = setup.fixture.base.join("outside");
        put(outside.join("settings.json"), ORIGINAL);
        fs::remove_file(&setup.source_settings).unwrap();
        match kind {
            "file-symlink" => {
                symlink(outside.join("settings.json"), &setup.source_settings).unwrap()
            }
            "parent-symlink" => {
                fs::remove_dir(setup.source_settings.parent().unwrap()).unwrap();
                symlink(&outside, setup.source_settings.parent().unwrap()).unwrap();
            }
            "hardlink" => {
                fs::hard_link(outside.join("settings.json"), &setup.source_settings).unwrap()
            }
            _ => unreachable!(),
        }
        assert!(setup.adopt().is_err());
        setup.assert_legacy_links();
        assert_eq!(
            fs::read_to_string(outside.join("settings.json")).unwrap(),
            ORIGINAL
        );
        assert!(
            fs::symlink_metadata(setup.fixture.home.join(CLAUDE))
                .unwrap()
                .is_symlink()
        );
        assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}

#[test]
fn rejects_edited_or_malformed_legacy_settings_before_any_resource_changes() {
    for changed in [
        r#"{"theme":"user-edited"}"#,
        "private-malformed-value",
        r#"{"theme":"old-theme","theme":"duplicate"}"#,
    ] {
        let setup = LegacyFixture::new();
        put(&setup.source_settings, changed);
        let error = setup.adopt().unwrap_err();
        assert!(!format!("{error:#}").contains("private-malformed-value"));
        setup.assert_legacy_links();
        assert_eq!(fs::read_to_string(&setup.source_settings).unwrap(), changed);
        assert_eq!(
            fs::read_to_string(setup.fixture.home.join(PI)).unwrap(),
            PI_ORIGINAL
        );
        assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}

#[test]
fn refuses_adoption_over_any_existing_ownership_record() {
    for contents in ["not json", "{}", r#"{"version":99}"#] {
        let setup = LegacyFixture::new();
        put(setup.fixture.home.join(RECORD), contents);
        assert!(setup.adopt().is_err());
        setup.assert_legacy_links();
        assert_eq!(
            fs::read_to_string(setup.fixture.home.join(RECORD)).unwrap(),
            contents
        );
        assert!(
            fs::symlink_metadata(setup.fixture.home.join(CLAUDE))
                .unwrap()
                .is_symlink()
        );
    }
}

#[test]
fn rejects_unsafe_or_duplicate_declarations_without_adopting_other_resources() {
    for kind in [
        "duplicate",
        "settings-duplicate",
        "protected",
        "relative",
        "traversal",
        "settings-outside",
        "settings-protected",
        "overlap",
    ] {
        let mut setup = LegacyFixture::new();
        match kind {
            "duplicate" => setup.legacy.links.push(setup.legacy.links[0].clone()),
            "settings-duplicate" => setup
                .legacy
                .settings_links
                .push(setup.legacy.settings_links[0].clone()),
            "protected" => setup.legacy.links[0].destination = ".pi/agent/auth.json".into(),
            "relative" => setup.legacy.links[0].target = "relative".into(),
            "traversal" => setup.legacy.links[0].target = setup.old.source.join("../outside"),
            "settings-outside" => {
                setup.legacy.settings_links[0].target = setup.fixture.base.join("outside")
            }
            "settings-protected" => {
                setup.legacy.settings_links[0].destination = ".pi/agent/auth.json".into()
            }
            "overlap" => setup.legacy.links.push(LegacyLink {
                destination: format!("{CLAUDE_SKILL}/child").into(),
                target: setup.old.source.join("child"),
            }),
            _ => unreachable!(),
        }
        assert!(setup.adopt().is_err());
        assert_eq!(
            setup.fixture.target(CLAUDE_SKILL),
            setup.old.source.join("skills/selected")
        );
        assert_eq!(
            fs::read_to_string(&setup.source_settings).unwrap(),
            ORIGINAL
        );
        assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}

#[test]
fn rejects_invalid_legacy_source_roots_without_adopting_resources() {
    for kind in ["relative", "root", "home", "redirect"] {
        let mut setup = LegacyFixture::new();
        setup.legacy.source = match kind {
            "relative" => "relative".into(),
            "root" => "/".into(),
            "home" => setup.fixture.home.clone(),
            "redirect" => {
                let alias = setup.fixture.base.join("source-alias");
                symlink(&setup.old.source, &alias).unwrap();
                alias
            }
            _ => unreachable!(),
        };
        assert!(setup.adopt().is_err());
        setup.assert_original();
    }
}

#[test]
fn protects_the_selected_source_from_settings_only_legacy_destinations() {
    for linked in [false, true] {
        let mut setup = LegacyFixture::new();
        setup.legacy.links.clear();
        setup.legacy.settings_links.clear();
        setup
            .legacy
            .settings
            .retain(|setting| setting.destination == std::path::Path::new(PI));
        if linked {
            setup.legacy.settings.clear();
            let source = setup.old.source.join("pi-settings.json");
            put(&source, PI_ORIGINAL);
            fs::remove_file(setup.fixture.home.join(PI)).unwrap();
            symlink(&source, setup.fixture.home.join(PI)).unwrap();
            setup.legacy.settings_links.push(LegacyLink {
                destination: PI.into(),
                target: source,
            });
        }
        setup.next.source = setup.fixture.home.join(".pi/agent");
        setup.next.links.clear();
        setup.next.settings.clear();
        assert!(setup.adopt().is_err());
        assert_eq!(
            fs::read_to_string(setup.fixture.home.join(PI)).unwrap(),
            PI_ORIGINAL
        );
        assert_eq!(
            fs::symlink_metadata(setup.fixture.home.join(PI))
                .unwrap()
                .is_symlink(),
            linked
        );
        assert_eq!(
            setup.fixture.target(CLAUDE_SKILL),
            setup.old.source.join("skills/selected")
        );
        assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}

#[test]
fn refuses_legacy_adoption_that_would_modify_the_selected_configuration_source() {
    let setup = LegacyFixture::new();
    let mut nested = setup.next.clone();
    nested.source = setup.fixture.home.join(".claude");
    nested.links.clear();
    nested.settings.clear();
    assert!(adopt_configuration(&setup.fixture.home, &nested, &setup.legacy).is_err());
    setup.assert_original();
}
