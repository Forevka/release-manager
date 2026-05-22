use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("sql: {0}")]
    Sql(#[from] sqlx::Error),
    #[error("migration: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("not found")]
    NotFound,
    #[error("conflict: {0}")]
    Conflict(String),
}

/// Wrapper around a SQLite pool. Cheap to clone (the pool is internally
/// reference-counted), so it's safe to hand out via Tauri state.
#[derive(Debug, Clone)]
pub struct Database {
    pool: SqlitePool,
    db_path: PathBuf,
}

impl Database {
    /// Open (or create) the SQLite database at `<dir>/db.sqlite` and run
    /// pending migrations. The parent directory is created if missing.
    pub async fn open(dir: &Path) -> Result<Self, StorageError> {
        std::fs::create_dir_all(dir)?;
        let db_path = dir.join("db.sqlite");

        let options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        sqlx::migrate!("./migrations").run(&pool).await?;

        Ok(Self { pool, db_path })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub fn path(&self) -> &Path {
        &self.db_path
    }
}
