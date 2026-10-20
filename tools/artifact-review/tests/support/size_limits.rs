use super::*;

const LIMIT: usize = 25 * 1024 * 1024;

#[test]
fn raster_images_use_the_same_25_mib_bound() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.resize(LIMIT, 0);
    let source = format!("data:image/png;base64,{}", STANDARD.encode(&png));
    assert_eq!(
        crate::images::prepare(Path::new("unused"), &source)
            .unwrap()
            .unwrap()
            .1
            .len(),
        LIMIT
    );
    let directory =
        std::env::temp_dir().join(format!("review-image-size-{:032x}", rand::random::<u128>()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .unwrap();
    let directory = directory.canonicalize().unwrap();
    let image = directory.join("render.png");
    fs::write(&image, &png).unwrap();
    let artifact = directory.join("report.html");
    assert_eq!(
        crate::images::prepare(&artifact, "render.png")
            .unwrap()
            .unwrap()
            .1
            .len(),
        LIMIT
    );
    png.push(0);
    fs::write(&image, &png).unwrap();
    assert!(crate::images::prepare(&artifact, "render.png").is_err());
    fs::remove_dir_all(directory).unwrap();
    let oversized = format!("data:image/png;base64,{}", STANDARD.encode(&png));
    assert!(crate::images::prepare(Path::new("unused"), &oversized).is_err());
}

#[test]
fn findings_records_use_the_same_25_mib_bound() {
    let directory =
        std::env::temp_dir().join(format!("review-json-size-{:032x}", rand::random::<u128>()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .unwrap();
    let file = directory.join("report.json");
    let mut bytes = serde_json::to_vec(
        &serde_json::json!({"version":1,"html_digest":"a".repeat(64),"findings":[]}),
    )
    .unwrap();
    bytes.resize(LIMIT, b' ');
    fs::write(&file, &bytes).unwrap();
    assert!(crate::findings::Binding::read(&file).is_ok());
    bytes.push(b' ');
    fs::write(&file, bytes).unwrap();
    assert_eq!(
        crate::findings::Binding::read(&file).err().unwrap(),
        "Findings report exceeds 25 MiB."
    );
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn html_reader_accepts_25_mib_and_rejects_larger_documents() {
    let directory =
        std::env::temp_dir().join(format!("review-size-{:032x}", rand::random::<u128>()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .unwrap();
    let file = directory.join("report.html");
    std::fs::write(&file, vec![b' '; LIMIT]).unwrap();
    assert_eq!(read_artifact(&file).unwrap().len(), LIMIT);
    std::fs::write(&file, vec![b' '; LIMIT + 1]).unwrap();
    assert_eq!(
        read_artifact(&file).unwrap_err(),
        "Artifact exceeds the 25 MiB limit."
    );
    fs::remove_dir_all(directory).unwrap();
}
