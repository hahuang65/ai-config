use super::Service;
use crate::{
    paths::{Descriptor, Paths, Result},
    store::Store,
};
use std::sync::{Arc, Mutex};
use tokio::{
    net::TcpListener,
    sync::{Notify, watch},
};

pub(super) async fn prepare(paths: &Paths) -> Result<(TcpListener, Service)> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Cannot bind local review server.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Cannot read local server port.")?
        .port();
    let capability = format!(
        "{:032x}{:032x}",
        rand::random::<u128>(),
        rand::random::<u128>()
    );
    let service = Service {
        store: Arc::new(Mutex::new(Store::open(paths)?)),
        paths: paths.clone(),
        capability: capability.clone(),
        origin: format!("http://127.0.0.1:{port}"),
        host: format!("127.0.0.1:{port}"),
        shutdown: Arc::new(Notify::new()),
        updates: watch::channel(false).0,
    };
    paths.save_descriptor(&Descriptor {
        pid: std::process::id(),
        port,
        capability,
    })?;
    Ok((listener, service))
}
