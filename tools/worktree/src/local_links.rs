//! Opt-in links to primary-checkout files, never dependency setup or copies.
use crate::{Error, Result, git, repository::Repository, text};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    os::unix::fs::{MetadataExt, symlink},
    path::{Component, Path, PathBuf},
};

pub struct Links {
    files: BTreeSet<PathBuf>,
}

impl Links {
    pub fn prepare(repo: &Repository) -> Result<Self> {
        let output = git::result(
            &repo.root,
            &["config", "--local", "--null", "--get-all", "wt.link"],
        )?;
        let bytes = match output.code {
            0 => output.raw_stdout,
            1 if output.raw_stdout.is_empty() => {
                return Ok(Self {
                    files: BTreeSet::new(),
                });
            }
            _ => {
                return Err(Error::new(
                    "Could not read repository-local wt.link settings.",
                ));
            }
        };
        let mut files = BTreeSet::new();
        let values = bytes
            .strip_suffix(&[0])
            .ok_or_else(|| Error::new("Invalid wt.link configuration response."))?;
        for value in values.split(|byte| *byte == 0) {
            let path = text::pathbuf(&text::decode(value));
            validate_path(&path)?;
            source_file(&repo.root, &path)?;
            files.insert(path);
        }
        let links = Self { files };
        links.refuse_tracked(repo, &["ls-files", "-z"])?;
        Ok(links)
    }

    fn refuse_tracked(&self, repo: &Repository, query: &[&str]) -> Result<()> {
        if self.files.is_empty() {
            return Ok(());
        }
        // Pathspec spelling can omit filesystem aliases (case or Unicode normalization).
        // Inspect Git's bounded name list, then compare actual filesystem identities.
        let output = git::raw(&repo.root, query)?;
        let mut scan = IdentityScan::default();
        let sources = LocalIdentities::read(&repo.root, &self.files, &mut scan)?;
        for name in output
            .split(|byte| *byte == 0)
            .filter(|name| !name.is_empty())
        {
            let tracked = text::pathbuf(&text::decode(name));
            let literal_overlap = self
                .files
                .iter()
                .any(|path| path.starts_with(&tracked) || tracked.starts_with(path));
            if literal_overlap || sources.overlaps(&scan.walk(&repo.root, &tracked)?) {
                return Err(Error::new(
                    "wt.link requires untracked local files that do not overlap tracked checkout content.",
                ));
            }
        }
        Ok(())
    }

    pub fn check_start(&self, repo: &Repository, start: &str) -> Result<()> {
        self.refuse_tracked(repo, &["ls-tree", "-r", "--name-only", "-z", start])
    }

    pub fn install(&self, primary: &Path, target: &Path) -> Result<()> {
        for path in &self.files {
            source_file(primary, path)?;
            destination(target, path)?;
        }
        for path in &self.files {
            let link = target.join(path);
            fs::create_dir_all(link.parent().expect("relative file parent"))?;
            destination(target, path)?;
            symlink(primary.join(path), link)?;
        }
        Ok(())
    }
}

type Identity = (u64, u64);

struct IdentityWalk {
    ids: Vec<Identity>,
    complete: bool,
}

#[derive(Default)]
struct LocalIdentities {
    files: BTreeSet<Identity>,
    ancestors: BTreeSet<Identity>,
}

impl LocalIdentities {
    fn read(root: &Path, files: &BTreeSet<PathBuf>, scan: &mut IdentityScan) -> Result<Self> {
        let mut identities = Self::default();
        for path in files {
            let walk = scan.walk(root, path)?;
            if !walk.complete || walk.ids.is_empty() {
                return Err(Error::new(
                    "A wt.link source changed during validation; inspect it before retrying.",
                ));
            }
            identities
                .files
                .insert(*walk.ids.last().expect("source identity"));
            identities.ancestors.extend(walk.ids);
        }
        Ok(identities)
    }

    fn overlaps(&self, tracked: &IdentityWalk) -> bool {
        tracked.ids.iter().any(|id| self.files.contains(id))
            || (tracked.complete
                && tracked
                    .ids
                    .last()
                    .is_some_and(|id| self.ancestors.contains(id)))
    }
}

#[derive(Clone, Copy)]
struct Node {
    id: Identity,
    directory: bool,
}

// Cache only within this pass.
// Installation always performs fresh safety checks.
#[derive(Default)]
struct IdentityScan {
    known: BTreeMap<PathBuf, Option<Node>>,
}

impl IdentityScan {
    fn walk(&mut self, root: &Path, relative: &Path) -> Result<IdentityWalk> {
        let mut prefix = PathBuf::new();
        let mut walk = IdentityWalk {
            ids: Vec::new(),
            complete: false,
        };
        for part in relative.components() {
            prefix.push(part);
            let Some(node) = self.node(root, &prefix)? else {
                return Ok(walk);
            };
            walk.ids.push(node.id);
            if prefix != relative && !node.directory {
                return Ok(walk);
            }
        }
        walk.complete = true;
        Ok(walk)
    }

    fn node(&mut self, root: &Path, relative: &Path) -> Result<Option<Node>> {
        if let Some(node) = self.known.get(relative) {
            return Ok(*node);
        }
        let node = match identity_metadata(&root.join(relative)) {
            Ok(metadata) => (!metadata.is_symlink()).then_some(Node {
                id: (metadata.dev(), metadata.ino()),
                directory: metadata.is_dir(),
            }),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                None
            }
            Err(error) => return Err(error.into()),
        };
        self.known.insert(relative.to_owned(), node);
        Ok(node)
    }
}

fn identity_metadata(path: &Path) -> std::io::Result<fs::Metadata> {
    #[cfg(test)]
    tests::record_identity_read(path);
    fs::symlink_metadata(path)
}

fn validate_path(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty()
        || path.components().any(|part| match part {
            Component::Normal(name) => {
                name.as_encoded_bytes().eq_ignore_ascii_case(b".git")
                    || name.as_encoded_bytes().eq_ignore_ascii_case(b".terraform")
            }
            _ => true,
        })
    {
        return Err(Error::new(
            "wt.link requires repository-relative file paths without traversal, .git, or .terraform components.",
        ));
    }
    Ok(())
}

fn source_file(primary: &Path, relative: &Path) -> Result<()> {
    let mut path = primary.to_owned();
    for part in relative.components() {
        path.push(part);
        let metadata = fs::symlink_metadata(&path).map_err(|_| {
            Error::new("A wt.link source is missing or unreadable in the primary checkout.")
        })?;
        if metadata.is_symlink() || (path != primary.join(relative) && !metadata.is_dir()) {
            return Err(Error::new(
                "wt.link sources and their parent directories must not be symlinks or special files.",
            ));
        }
    }
    if !fs::symlink_metadata(primary.join(relative))?.is_file() {
        return Err(Error::new(
            "wt.link sources must be regular files, not directories or special files.",
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/support/local_link_identities.rs"]
mod tests;

fn destination(target: &Path, relative: &Path) -> Result<()> {
    let mut path = target.to_owned();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if path != target.join(relative) && metadata.is_dir() => (),
            Ok(_) => {
                return Err(Error::new(
                    "A wt.link destination or parent conflicts with existing checkout content; nothing is overwritten.",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
