use super::support::Review;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    os::unix::fs::DirBuilderExt,
    time::{Duration, Instant},
};

const PEER_GUARD: Duration = Duration::from_secs(5);
const ACCEPT_POLL: Duration = Duration::from_millis(5);

pub struct EventPeer(TcpListener);

impl EventPeer {
    pub fn new(review: &Review) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let artifact = review.file.canonicalize().unwrap();
        let directory = review.root.join("state").join(format!(
            "{:x}",
            Sha256::digest(artifact.as_os_str().as_encoded_bytes())
        ));
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&directory)
            .unwrap();
        fs::write(
            directory.join("server.json"),
            json!({
                "pid":std::process::id(), "port":listener.local_addr().unwrap().port(),
                "capability":"synthetic-local-test-capability",
            })
            .to_string(),
        )
        .unwrap();
        Self(listener)
    }

    pub fn request(&self) -> TcpStream {
        let deadline = Instant::now() + PEER_GUARD;
        let mut stream = loop {
            match self.0.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        Instant::now() < deadline,
                        "CLI did not continue waiting after an empty heartbeat"
                    );
                    std::thread::sleep(ACCEPT_POLL);
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream.set_read_timeout(Some(PEER_GUARD)).unwrap();
        stream.set_write_timeout(Some(PEER_GUARD)).unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            assert!(request.len() < 4096);
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        assert!(request.starts_with(b"GET /events?cursor=0&wait_ms="));
        stream
    }

    pub fn hold_body(mut stream: TcpStream) -> TcpStream {
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n").unwrap();
        stream
    }

    pub fn respond(mut stream: TcpStream, events: Value) {
        let page = json!({"events":events,"cursor":events.as_array().unwrap().len(),
            "status":"open","more":false,"approved_revision":null,
            "current_revision":"0".repeat(64),"needs_review":true})
        .to_string();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).unwrap();
    }
}
