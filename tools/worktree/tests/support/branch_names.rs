use super::*;
use std::cell::Cell;

#[test]
fn successful_names_are_reused_only_inside_their_repository_instance() {
    let calls = Cell::new(0);
    let check = || {
        calls.set(calls.get() + 1);
        Ok(true)
    };
    for _ in 0..2 {
        let names = BranchNames::new(Path::new("/fixture"));
        assert!(names.validate("main", check).unwrap());
        assert!(names.validate("main", check).unwrap());
        assert!(names.validate("other", check).unwrap());
    }
    assert_eq!(calls.get(), 4);
}

#[test]
fn rejected_names_and_operational_failures_are_never_remembered() {
    let names = BranchNames::new(Path::new("/fixture"));
    assert!(!names.validate("main", || Ok(false)).unwrap());
    assert!(
        names
            .validate("main", || Err(Error::new("unavailable")))
            .is_err()
    );
    assert!(names.validate("main", || Ok(true)).unwrap());
    assert!(
        names
            .validate("main", || panic!("repeat syntax check"))
            .unwrap()
    );
    for name in ["", "-option"] {
        assert!(
            !names
                .validate(name, || panic!("unsafe argument reached Git"))
                .unwrap()
        );
    }
}

#[test]
fn reaching_the_entry_limit_keeps_validating_uncached_names() {
    let names = BranchNames::new(Path::new("/fixture"));
    for index in 0..MAX_BRANCH_NAMES {
        assert!(
            names
                .validate(&format!("branch-{index}"), || Ok(true))
                .unwrap()
        );
    }
    let calls = Cell::new(0);
    for _ in 0..2 {
        assert!(
            names
                .validate("overflow", || {
                    calls.set(calls.get() + 1);
                    Ok(true)
                })
                .unwrap()
        );
    }
    assert_eq!(calls.get(), 2);
    assert!(
        names
            .validate("branch-0", || panic!("cached entry was lost"))
            .unwrap()
    );
}

#[test]
fn name_lengths_are_bounded_in_bytes_without_rejecting_long_valid_names() {
    let names = BranchNames::new(Path::new("/fixture"));
    let boundary = "a".repeat(MAX_BRANCH_NAME_BYTES);
    assert!(names.validate(&boundary, || Ok(true)).unwrap());
    assert!(
        names
            .validate(&boundary, || panic!("boundary should be cached"))
            .unwrap()
    );
    let calls = Cell::new(0);
    for name in [
        "a".repeat(MAX_BRANCH_NAME_BYTES + 1),
        "é".repeat(MAX_BRANCH_NAME_BYTES / 2 + 1),
    ] {
        for _ in 0..2 {
            assert!(
                names
                    .validate(&name, || {
                        calls.set(calls.get() + 1);
                        Ok(true)
                    })
                    .unwrap()
            );
        }
    }
    assert_eq!(calls.get(), 4);
}
