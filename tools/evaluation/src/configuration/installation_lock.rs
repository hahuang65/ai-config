use super::real_ancestors;
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::Path,
};

pub(super) struct InstallationLock(File);

impl Drop for InstallationLock {
    fn drop(&mut self) {
        // Closing alone can leave the lock held by a concurrently forked child.
        // Explicit unlock releases the shared open-file description before close.
        let _ = FileExt::unlock(&self.0);
    }
}

pub(super) fn lock(state: &Path) -> Result<InstallationLock> {
    real_ancestors(state)?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(state)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(state.join("install.lock"))?;
    ensure!(
        file.metadata()?.is_file(),
        "Installation lock must be a regular file"
    );
    file.try_lock_exclusive()
        .context("Another configuration installer is running; retry when it finishes")?;
    Ok(InstallationLock(file))
}
