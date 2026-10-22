use crate::{
    images,
    model::Snapshot,
    paths::{Paths, Result},
    svg,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

// One bounded successful render per process, keyed by exact source bytes and artifact path.
// Every reuse still reads/validates/hashes current HTML and all displayed image bytes.
static CACHE: OnceLock<Mutex<Option<Rendered>>> = OnceLock::new();

struct Rendered {
    artifact: PathBuf,
    source: String,
    images: Vec<String>,
    snapshot: Snapshot,
}

impl Rendered {
    fn matches(&self, paths: &Paths, source: &str) -> bool {
        self.artifact == paths.artifact && self.source == source
    }

    fn revision(&self, paths: &Paths) -> Result<String> {
        let mut state = ImageState::new(&self.source);
        for source in &self.images {
            state.load(&paths.artifact, source)?;
        }
        Ok(format!("{:x}", state.digest.finalize()))
    }
}

pub fn revision(paths: &Paths) -> Result<String> {
    let source = paths.read_artifact()?;
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("render cache lock");
    if let Some(rendered) = cache.as_ref().filter(|entry| entry.matches(paths, &source)) {
        return rendered.revision(paths);
    }
    let rendered = render(paths, source)?;
    let revision = rendered.snapshot.revision.clone();
    *cache = Some(rendered);
    Ok(revision)
}

pub fn snapshot(paths: &Paths) -> Result<Snapshot> {
    let source = paths.read_artifact()?;
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("render cache lock");
    if let Some(rendered) = cache.as_ref().filter(|entry| entry.matches(paths, &source))
        && rendered.revision(paths)? == rendered.snapshot.revision
    {
        return Ok(rendered.snapshot.clone());
    }
    let rendered = render(paths, source)?;
    let snapshot = rendered.snapshot.clone();
    *cache = Some(rendered);
    Ok(snapshot)
}

struct ImageState {
    digest: Sha256,
    sources: Vec<String>,
    total: usize,
    error: Option<&'static str>,
}

impl ImageState {
    fn new(source: &str) -> Self {
        Self {
            digest: Sha256::new_with_prefix(source.as_bytes()),
            sources: vec![],
            total: 0,
            error: None,
        }
    }

    fn load(&mut self, artifact: &Path, source: &str) -> Result<Option<(&'static str, Vec<u8>)>> {
        let Some((mime, bytes)) = images::prepare(artifact, source)? else {
            return Ok(None);
        };
        if self.sources.len() >= images::MAX_IMAGES
            || self.total.saturating_add(bytes.len()) > images::MAX_TOTAL_BYTES
        {
            return Err("Too many render bytes. Approval is unavailable.");
        }
        self.sources.push(source.to_owned());
        self.total += bytes.len();
        self.digest.update(b"\0render\0");
        self.digest.update(mime.as_bytes());
        self.digest.update((bytes.len() as u64).to_le_bytes());
        self.digest.update(&bytes);
        Ok(Some((mime, bytes)))
    }

    fn inline(&mut self, artifact: &Path, source: &str) -> Option<String> {
        if self.error.is_some() {
            return None;
        }
        match self.load(artifact, source) {
            Ok(Some((mime, bytes))) => {
                Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
            }
            Ok(None) => None,
            Err(error) => {
                self.error = Some(error);
                None
            }
        }
    }
}

fn pr_link(value: &str) -> bool {
    let Some(path) = value.strip_prefix("https://github.com/") else {
        return false;
    };
    let parts: Vec<_> = path.split('/').collect();
    parts.len() == 4
        && parts[..2].iter().all(|name| {
            !name.is_empty()
                && !matches!(*name, "." | "..")
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        })
        && parts[2] == "pull"
        && parts[3].bytes().all(|byte| byte.is_ascii_digit())
        && parts[3].parse::<u64>().is_ok_and(|number| number > 0)
}

fn sanitize(paths: &Paths, source: &str, images: Arc<Mutex<ImageState>>) -> String {
    let artifact = paths.artifact.clone();
    let mut builder = ammonia::Builder::default();
    svg::configure(&mut builder);
    builder
        .add_tags(
            ["style", "section", "main", "article", "aside"]
                .iter()
                .copied(),
        )
        .rm_clean_content_tags(["style"].iter().copied())
        .add_clean_content_tags(["title"].iter().copied())
        .add_generic_attributes(["id", "class", "style"].iter().copied())
        .rm_tag_attributes("a", ["target"].iter().copied())
        .rm_tag_attributes("img", ["srcset"].iter().copied())
        .add_url_schemes(&["data"])
        .attribute_filter(move |element, attribute, value| {
            if element == "a" && attribute == "href" {
                return pr_link(value).then_some(Cow::Borrowed(value));
            }
            if element != "img" || attribute != "src" {
                return svg::attribute(element, attribute, value);
            }
            images
                .lock()
                .expect("render state lock")
                .inline(&artifact, value)
                .map(Cow::Owned)
        })
        .link_rel(Some("noopener noreferrer"))
        .clean(source)
        .to_string()
}

fn render(paths: &Paths, source: String) -> Result<Rendered> {
    let state = Arc::new(Mutex::new(ImageState::new(&source)));
    let html = sanitize(paths, &source, state.clone());
    let state = state.lock().expect("render state lock");
    if let Some(error) = state.error {
        return Err(error);
    }
    let revision = format!("{:x}", state.digest.clone().finalize());
    let policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'";
    Ok(Rendered {
        artifact: paths.artifact.clone(),
        source,
        images: state.sources.clone(),
        snapshot: Snapshot {
            revision,
            html: format!(
                "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\"></head><body>{html}</body></html>"
            ),
        },
    })
}
