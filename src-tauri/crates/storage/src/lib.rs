//! Persistence layer for the release manager.
//!
//! - [`Database`] wraps a SQLite connection pool and runs embedded migrations.
//! - [`SecretStore`] wraps the OS keychain for tokens and other secrets.
//! - Sibling modules expose typed query helpers per entity.

pub mod db;
pub mod secret;
pub mod settings;
pub mod groups;
pub mod repos;

pub use db::{Database, StorageError};
pub use secret::{SecretError, SecretStore};
