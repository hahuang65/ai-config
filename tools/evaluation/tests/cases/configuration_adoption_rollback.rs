use crate::{fixture, legacy};
use evaluation::configuration::Link;
use fixture::{CLAUDE_SETTINGS as CLAUDE, PI_SETTINGS as PI, RECORD, put};
use legacy::{LegacyFixture, ORIGINAL};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::PermissionsExt;

fn fail_after_preflight(setup: &LegacyFixture, directory: &str) {
    let state = setup.fixture.home.join(".local/state/ai-config");
    fs::create_dir_all(&state).unwrap();
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(state.join("install.lock"))
        .unwrap();
    let path = setup.fixture.home.join(directory);
    let permissions = fs::metadata(&path).unwrap().permissions();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = setup.adopt();
    fs::set_permissions(path, permissions).unwrap();
    let error = outcome.expect_err("This failure fixture requires an unprivileged user");
    assert!(
        error
            .to_string()
            .contains("prior links and settings restored"),
        "{error:#}"
    );
}

#[test]
fn restores_legacy_links_and_the_settings_symlink_after_settings_or_record_write_failure() {
    for directory in [".claude", ".pi/agent", ".local/state/ai-config"] {
        let mut setup = LegacyFixture::new();
        put(
            setup.next.source.join("bin/new-command"),
            "fixture executable",
        );
        setup.next.links.push(Link {
            destination: ".local/bin/new-command".into(),
            target: "bin/new-command".into(),
        });
        fs::set_permissions(&setup.source_settings, fs::Permissions::from_mode(0o440)).unwrap();
        fail_after_preflight(&setup, directory);
        setup.assert_original();
        assert_eq!(
            fs::metadata(&setup.source_settings)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o440
        );
        assert!(
            setup
                .fixture
                .home
                .join(".local/bin/new-command")
                .symlink_metadata()
                .is_err()
        );
        // The lock is reusable and a later authorized adoption can complete.
        setup.adopt().unwrap();
        setup.fixture.assert_source(&setup.next);
    }
}

#[test]
fn removes_new_settings_files_without_rewriting_the_legacy_settings_source_on_failure() {
    let setup = LegacyFixture::new();
    fs::remove_file(setup.fixture.home.join(PI)).unwrap();
    fail_after_preflight(&setup, ".local/state/ai-config");
    setup.assert_legacy_links();
    assert_eq!(
        fs::read_link(setup.fixture.home.join(CLAUDE)).unwrap(),
        setup.source_settings
    );
    assert_eq!(
        fs::read_to_string(&setup.source_settings).unwrap(),
        ORIGINAL
    );
    assert!(setup.fixture.home.join(PI).symlink_metadata().is_err());
    assert!(setup.fixture.home.join(RECORD).symlink_metadata().is_err());
}
