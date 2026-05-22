use rm_storage::{Database, SecretStore};

use crate::watcher::WatcherManager;

/// Process-wide state injected into every async command.
pub struct AppState {
    pub db: Database,
    pub secrets: SecretStore,
    pub watcher: WatcherManager,
}
