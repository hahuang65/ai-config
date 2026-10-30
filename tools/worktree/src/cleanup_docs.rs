//! Copy ignored docs before ordinary cleanup, without changing its safety rules.
use crate::{Error, Result, git, process, text};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

pub struct Documents {
    source: PathBuf,
    destination: PathBuf,
    paths: Vec<PathBuf>,
}

impl Documents {
    pub fn prepare(source: &Path, destination: &Path) -> Result<Self> {
        let docs = Self {
            source: source.into(),
            destination: destination.into(),
            paths: inventory(source)?,
        };
        docs.verify_existing()?;
        Ok(docs)
    }

    pub fn count(&self) -> usize {
        self.paths.len()
    }

    pub fn preserve(&self) -> Result<()> {
        for path in &self.paths {
            if process::interrupted() {
                return Err(Error::new("Interrupted; task retained."));
            }
            parents(&self.destination, path, true)?;
            let mut source = regular(&self.source.join(path))?;
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(source.metadata()?.permissions().mode() & 0o777)
                .open(self.destination.join(path))
            {
                Ok(mut copy) => {
                    io::copy(&mut source, &mut copy)?;
                    copy.sync_all()?;
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        self.verify()
    }

    pub fn verify(&self) -> Result<()> {
        if inventory(&self.source)? != self.paths {
            return Err(Error::new(
                "Private docs changed; task retained. Stop other work before retrying cleanup.",
            ));
        }
        for path in &self.paths {
            same(&self.source.join(path), &self.destination.join(path))?;
        }
        Ok(())
    }

    fn verify_existing(&self) -> Result<()> {
        for path in &self.paths {
            if !parents(&self.destination, path, false)? {
                continue;
            }
            match self.destination.join(path).symlink_metadata() {
                Ok(_) => same(&self.source.join(path), &self.destination.join(path))?,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }
}

fn inventory(source: &Path) -> Result<Vec<PathBuf>> {
    let output = git::result(source, &["ls-files", "--cached", "-z", "--", "docs"])?;
    if output.code != 0 {
        return Err(Error::new("Cannot enumerate tracked docs; task retained."));
    }
    let tracked: BTreeSet<_> = text::decode(&output.raw_stdout)
        .split('\0')
        .filter(|name| !name.is_empty())
        .map(text::pathbuf)
        .collect();
    let (mut pending, mut paths) = (vec![PathBuf::from("docs")], Vec::new());
    while let Some(path) = pending.pop() {
        if process::interrupted() {
            return Err(Error::new("Interrupted; task retained."));
        }
        if tracked.contains(&path) {
            continue;
        }
        let metadata = match source.join(&path).symlink_metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound && path == Path::new("docs") => {
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        if metadata.is_dir() {
            for child in fs::read_dir(source.join(&path))? {
                let child = child?;
                if child.file_name() == ".git" {
                    return Err(Error::new(
                        "Nested Git metadata under docs must be preserved manually; task retained.",
                    ));
                }
                pending.push(path.join(child.file_name()));
            }
        } else if metadata.is_file() {
            if path != Path::new("docs") {
                paths.push(path);
            }
        } else {
            return Err(Error::new(
                "Private docs contain a path that is not a regular file or directory; task retained.",
            ));
        }
    }
    paths.sort();
    Ok(paths)
}

fn parents(root: &Path, path: &Path, create: bool) -> Result<bool> {
    let mut directory = root.to_path_buf();
    for component in path.parent().unwrap().components() {
        directory.push(component);
        match directory.symlink_metadata() {
            Ok(metadata) if metadata.is_dir() => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if !create {
                    return Ok(false);
                }
                fs::DirBuilder::new().mode(0o700).create(&directory)?;
            }
            _ => {
                return Err(Error::new(
                    "Private doc destination is not a regular directory; task retained.",
                ));
            }
        }
    }
    Ok(true)
}

fn regular(path: &Path) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err(Error::new(
            "Private doc is not a regular file; task retained.",
        ));
    }
    Ok(file)
}

fn same(source: &Path, destination: &Path) -> Result<()> {
    let (mut source, mut copy) = (regular(source)?, regular(destination)?);
    let mut remaining = source.metadata()?.len();
    if remaining != copy.metadata()?.len() {
        return Err(conflict());
    }
    let (mut left, mut right) = ([0; 64 * 1024], [0; 64 * 1024]);
    while remaining > 0 {
        if process::interrupted() {
            return Err(Error::new("Interrupted; task retained."));
        }
        let count = remaining.min(left.len() as u64) as usize;
        source.read_exact(&mut left[..count])?;
        copy.read_exact(&mut right[..count])?;
        if left[..count] != right[..count] {
            return Err(conflict());
        }
        remaining -= count as u64;
    }
    Ok(())
}

fn conflict() -> Error {
    Error::new(
        "Primary docs differ from the task documents. Resolve the conflict without overwriting before retrying cleanup; task retained.",
    )
}
