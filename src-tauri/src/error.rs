//! Command error type. Serializes to a flat string for easy use from the
//! frontend (`invoke(...).catch(e => ...)` gets the message directly).

use rm_storage::{SecretError, StorageError};

/// Newtype wrapper so command bodies can use `?` against typed errors and
/// still get a `String` shape over IPC.
#[derive(Debug)]
pub struct CommandErr(pub String);

impl std::fmt::Display for CommandErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl serde::Serialize for CommandErr {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl From<StorageError> for CommandErr {
    fn from(e: StorageError) -> Self {
        CommandErr(e.to_string())
    }
}

impl From<SecretError> for CommandErr {
    fn from(e: SecretError) -> Self {
        CommandErr(e.to_string())
    }
}
