use crate::error::{Error, Result};
use crate::model::{Entry, Log};
use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const LOCK_TIMEOUT: Duration = Duration::from_secs(3);
const LOCK_POLL: Duration = Duration::from_millis(20);
const MAX_ENTRY_BYTES: u64 = 32 * 1024;

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn locate() -> Result<Self> {
        let root = match std::env::var_os("WL_ROOT") {
            Some(value) if !value.is_empty() => PathBuf::from(value),
            Some(_) => return Err(Error::usage("WL_ROOT must be an absolute directory path")),
            None => {
                let home = std::env::var_os("HOME")
                    .filter(|value| !value.is_empty())
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .ok_or_else(|| {
                        Error::usage("HOME must be an absolute directory path, or set WL_ROOT")
                    })?;
                home.join(".worklog")
            }
        };
        if !root.is_absolute() {
            return Err(Error::usage("WL_ROOT must be an absolute directory path"));
        }
        Ok(Self { root })
    }

    pub fn read(&self) -> Result<Log> {
        if !directory_exists(&self.root)? {
            return Ok(Log::default());
        }
        let events_path = self.root.join("events");
        if !directory_exists(&events_path)? {
            return Ok(Log::default());
        }
        let mut paths = fs::read_dir(events_path)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<std::io::Result<Vec<_>>>()?;
        paths.sort();
        let entries = paths
            .iter()
            .enumerate()
            .map(|(index, path)| read_entry(path, index as u64 + 1))
            .collect::<Result<Vec<_>>>()?;
        Log::from_entries(entries)
    }

    pub fn append(&self, build: impl Fn(&Log) -> Result<Entry>) -> Result<Entry> {
        self.append_with_initializer(build, ensure_directory)
    }

    fn append_with_initializer(
        &self,
        build: impl Fn(&Log) -> Result<Entry>,
        initialize: impl FnOnce(&Path) -> Result<()>,
    ) -> Result<Entry> {
        let mut preview = self.read()?;
        preview.apply(build(&preview)?)?;
        initialize(&self.root)?;
        let lock_path = self.root.join(".lock");
        check_regular_if_present(&lock_path)?;
        let lock = private_options().create(true).open(lock_path)?;
        acquire_lock(&lock)?;
        let mut log = self.read()?;
        let entry = build(&log)?;
        log.apply(entry.clone())?;
        self.publish(&entry)?;
        Ok(entry)
    }

    fn publish(&self, entry: &Entry) -> Result<()> {
        let events = self.root.join("events");
        ensure_directory(&events)?;
        let pending = self.root.join(".pending");
        if check_regular_if_present(&pending)? {
            fs::remove_file(&pending)?;
        }
        let encoded = serde_json::to_vec(entry).map_err(|_| Error::corrupt())?;
        let mut file = private_options().create_new(true).open(&pending)?;
        if let Err(error) = write_pending(&mut file, &encoded) {
            let _ = fs::remove_file(&pending);
            return Err(error);
        }
        let destination = events.join(format!("{:020}.json", entry.id));
        if let Err(error) = fs::hard_link(&pending, destination) {
            let _ = fs::remove_file(&pending);
            return Err(error.into());
        }
        finish_publish(&events, &pending, &self.root)
    }
}

fn read_entry(path: &Path, id: u64) -> Result<Entry> {
    if path.file_name().and_then(|name| name.to_str()) != Some(&format!("{id:020}.json")) {
        return Err(Error::corrupt());
    }
    if !check_regular_if_present(path)? {
        return Err(Error::corrupt());
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_ENTRY_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_ENTRY_BYTES as usize {
        return Err(Error::corrupt());
    }
    serde_json::from_slice(&bytes).map_err(|_| Error::corrupt())
}

fn write_pending(file: &mut File, encoded: &[u8]) -> Result<()> {
    file.write_all(encoded)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

fn finish_publish(events: &Path, pending: &Path, root: &Path) -> Result<()> {
    let finish = || -> std::io::Result<()> {
        File::open(events)?.sync_all()?;
        fs::remove_file(pending)?;
        File::open(root)?.sync_all()
    };
    finish().map_err(|_| Error {
        code: 1,
        message: "entry was published but durability confirmation failed; inspect history before retrying",
    })
}

fn acquire_lock(file: &File) -> Result<()> {
    let started = Instant::now();
    loop {
        match FileExt::try_lock_exclusive(file) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(error) => return Err(error.into()),
        }
        if started.elapsed() >= LOCK_TIMEOUT {
            return Err(Error::busy());
        }
        thread::sleep(LOCK_POLL);
    }
}

fn directory_exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(Error::storage()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn check_regular_if_present(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(true),
        Ok(_) => Err(Error::storage()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn create_private_directory(path: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

fn ensure_directory(path: &Path) -> Result<()> {
    ensure_directory_with(path, create_private_directory, |parent| {
        File::open(parent)?.sync_all()
    })
}

fn ensure_directory_with(
    path: &Path,
    create: impl FnOnce(&Path) -> std::io::Result<()>,
    sync: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<()> {
    if !directory_exists(path)? {
        match create(path) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if !directory_exists(path)? {
                    return Err(Error::storage());
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    if let Some(parent) = path.parent() {
        sync(parent)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/cases/store_initialization.rs"]
mod initialization_tests;

fn private_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
}
