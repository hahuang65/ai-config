use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct Error {
    pub code: u8,
    pub message: &'static str,
}

impl Error {
    pub fn usage(message: &'static str) -> Self {
        Self { code: 2, message }
    }

    pub fn storage() -> Self {
        Self {
            code: 1,
            message: "cannot access WL storage; check WL_ROOT and directory permissions",
        }
    }

    pub fn corrupt() -> Self {
        Self {
            code: 1,
            message: "WL history is invalid; preserve the store and restore it from a trusted backup",
        }
    }

    pub fn busy() -> Self {
        Self {
            code: 1,
            message: "WL storage is busy; retry after the other writer exits",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::storage()
    }
}
