#[path = "support/configuration.rs"]
mod fixture;
use evaluation::configuration::{Link, switch_configuration as switch_links};
use fixture::{CLAUDE_SKILL, Fixture, OBSOLETE, PI_SKILL, RECORD, put};
use fs2::FileExt;
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{PermissionsExt, symlink};

const RETAINED: [&str; 5] = [
    ".claude/projects/history-sentinel",
    ".pi/agent/sessions/history-sentinel",
    ".pi/agent/settings.json",
    ".claude/settings.json",
    ".pi/agent/trust.json",
];

#[test]
fn switches_both_harnesses_repeatedly_and_removes_only_obsolete_owned_links() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared π ' source", true);
    let minimal = fixture.source("minimal source", false);
    let unrelated = fixture.base.join("independent-skill");
    put(unrelated.join("SKILL.md"), "independent instructions");
    fs::create_dir_all(fixture.home.join(".pi/agent/skills")).unwrap();
    symlink(
        &unrelated,
        fixture.home.join(".pi/agent/skills/independent"),
    )
    .unwrap();
    for path in RETAINED {
        put(fixture.home.join(path), "unrelated state");
    }
    for manifest in [&shared, &shared, &minimal, &minimal, &shared] {
        fixture.install(manifest);
        fixture.assert_source(manifest);
        assert_eq!(fixture.target(".pi/agent/skills/independent"), unrelated);
    }
    for path in RETAINED {
        assert_eq!(
            fs::read_to_string(fixture.home.join(path)).unwrap(),
            "unrelated state"
        );
    }
    assert!(shared.source.join("extensions/obsolete.ts").is_file());
}

#[test]
fn restores_both_harnesses_when_the_ownership_record_cannot_be_saved() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    let before = fixture.record();
    let directory = fixture.home.join(RECORD).parent().unwrap().to_owned();
    let permissions = fs::metadata(&directory).unwrap().permissions();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = switch_links(&fixture.home, &minimal);
    fs::set_permissions(directory, permissions).unwrap();
    assert!(
        outcome.is_err(),
        "This failure fixture requires an unprivileged user"
    );
    fixture.assert_source(&shared);
    assert_eq!(
        fixture.target(OBSOLETE),
        shared.source.join("extensions/obsolete.ts")
    );
    assert_eq!(fixture.record(), before);
}

#[test]
fn removes_newly_added_links_when_saving_the_new_record_fails() {
    let fixture = Fixture::new();
    let minimal = fixture.source("minimal", false);
    let shared = fixture.source("shared", true);
    fixture.install(&minimal);
    let before = fixture.record();
    let directory = fixture.home.join(RECORD).parent().unwrap().to_owned();
    let permissions = fs::metadata(&directory).unwrap().permissions();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = switch_links(&fixture.home, &shared);
    fs::set_permissions(directory, permissions).unwrap();
    assert!(
        outcome.is_err(),
        "This failure fixture requires an unprivileged user"
    );
    fixture.assert_source(&minimal);
    assert!(fixture.home.join(OBSOLETE).symlink_metadata().is_err());
    assert_eq!(fixture.record(), before);
}

#[test]
fn restores_the_first_harness_when_the_second_harness_cannot_be_written() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    let directory = fixture.home.join(PI_SKILL).parent().unwrap().to_owned();
    let permissions = fs::metadata(&directory).unwrap().permissions();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = switch_links(&fixture.home, &minimal);
    fs::set_permissions(directory, permissions).unwrap();
    assert!(
        outcome.is_err(),
        "This failure fixture requires an unprivileged user"
    );
    fixture.assert_source(&shared);
}

#[test]
fn recreates_a_missing_owned_link_without_changing_its_source() {
    let fixture = Fixture::new();
    let source = fixture.source("source", false);
    fixture.install(&source);
    fs::remove_file(fixture.home.join(CLAUDE_SKILL)).unwrap();
    fixture.install(&source);
    fixture.assert_source(&source);
}

#[test]
fn switches_away_from_a_removed_source_using_recorded_dangling_link_ownership() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    fs::remove_dir_all(&shared.source).unwrap();
    fixture.install(&minimal);
    fixture.assert_source(&minimal);
}

#[test]
fn refuses_a_second_installer_without_changing_the_active_source() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .open(fixture.home.join(".local/state/ai-config/install.lock"))
        .unwrap();
    lock.lock_exclusive().unwrap();
    assert!(switch_links(&fixture.home, &minimal).is_err());
    fixture.assert_source(&shared);
}

#[test]
fn switches_an_owned_executable_link_with_the_harness_resources() {
    let fixture = Fixture::new();
    let mut shared = fixture.source("shared", true);
    let mut minimal = fixture.source("minimal", false);
    for manifest in [&mut shared, &mut minimal] {
        put(
            manifest.source.join("bin/fixture-tool"),
            "fixture executable source",
        );
        manifest.links.push(Link {
            destination: ".local/bin/fixture-tool".into(),
            target: "bin/fixture-tool".into(),
        });
    }
    for manifest in [&shared, &minimal, &shared] {
        fixture.install(manifest);
        fixture.assert_source(manifest);
        assert_eq!(
            fixture.target(".local/bin/fixture-tool"),
            manifest.source.join("bin/fixture-tool")
        );
    }
}

#[test]
fn stores_the_record_with_private_permissions() {
    let fixture = Fixture::new();
    fixture.install(&fixture.source("source", false));
    let path = fixture.home.join(RECORD);
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}
