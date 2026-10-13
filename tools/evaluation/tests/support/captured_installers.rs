use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

// Verify historical inputs before executing their scripts in a disposable home.
const CAPTURES: &[(&str, &str)] = &[
    (
        "legacy-shared/install.sh",
        "f0eb635f5a1cba42a45c24ddba7a139a6edae4839b1a0ba68b568a5c675ddea6",
    ),
    (
        "legacy-shared/harnesses/claude/manifest.sh",
        "78708a791c0ab375c25044e23d98371216f246be95fa10f17ccebd6f68050be2",
    ),
    (
        "legacy-shared/harnesses/pi/manifest.sh",
        "ed3499506099d309a547c0be76dcbb18fafaa92507db87d660f3a70b6ce8e359",
    ),
    (
        "legacy-shared/harnesses/claude/settings.json",
        "d1632b311ad03230b5a8027d92d54593e7bc3c5413ec569f0909b24bd97843b9",
    ),
    (
        "legacy-shared/harnesses/pi/settings.json",
        "6ba1a1e7f08bf729f902270f41b57710b8b892415aa1f8a102114aa0646d92d0",
    ),
    (
        "legacy-shared/source-tree.json",
        "e460e76f2723da60a2db53d40a8e1475c0d5e868072205481cc9f3d4f6a12578",
    ),
];

pub fn read(relative: &str) -> Vec<u8> {
    let (_, expected) = CAPTURES
        .iter()
        .find(|(path, _)| *path == relative)
        .expect("undeclared installer capture");
    let path = match relative {
        "legacy-shared/harnesses/claude/settings.json" => {
            "src/configuration/legacy_defaults/claude.json".to_owned()
        }
        "legacy-shared/harnesses/pi/settings.json" => {
            "src/configuration/legacy_defaults/pi.json".to_owned()
        }
        _ => format!("tests/fixtures/{relative}"),
    };
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    let bytes = fs::read(path).unwrap();
    assert_eq!(
        &format!("{:x}", Sha256::digest(&bytes)),
        expected,
        "installer capture changed: {relative}"
    );
    bytes
}
