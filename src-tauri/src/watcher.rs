//! Per-repo file-system watcher that emits `repo-changed { repoId }` events
//! when relevant `.git/` files change.
//!
//! "Relevant" = `HEAD`, `MERGE_HEAD`, or anything under `refs/heads/`. We
//! deliberately ignore the noisy `objects/`, `logs/`, and `index` churn since
//! we only care about *user-visible* state changes (checkouts, commits,
//! merge progress, branch ref updates) — not internal git plumbing.
//!
//! Lifecycle is controlled from the frontend via the `watch_group_repos` /
//! `clear_watched_repos` commands so we only spend resources on repos the
//! user is actively looking at.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use uuid::Uuid;

pub const REPO_CHANGED: &str = "repo-changed";
const DEBOUNCE_MS: u64 = 300;

pub struct WatcherManager {
    inner: Mutex<HashMap<Uuid, ActiveWatch>>,
    app: AppHandle,
}

/// Holds the OS watcher handle and the sender end of the debounce channel.
/// Dropping this stops the watcher and (by closing the channel) lets the
/// debounce task exit cleanly.
struct ActiveWatch {
    _watcher: RecommendedWatcher,
    _sender: mpsc::UnboundedSender<()>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoChangedPayload {
    repo_id: String,
}

impl WatcherManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            app,
        }
    }

    /// Diff the current set of watchers against `wanted`: drop watchers that
    /// are no longer requested, start watchers for any new entries.
    pub fn set_watched(&self, wanted: Vec<(Uuid, PathBuf)>) {
        let wanted_map: HashMap<Uuid, PathBuf> = wanted.into_iter().collect();
        let mut inner = self.inner.lock().unwrap();
        inner.retain(|id, _| wanted_map.contains_key(id));
        for (id, path) in wanted_map {
            if inner.contains_key(&id) {
                continue;
            }
            match self.start_one(id, &path) {
                Ok(active) => {
                    inner.insert(id, active);
                }
                Err(e) => {
                    tracing::warn!(
                        repo_id = %id,
                        path = %path.display(),
                        error = %e,
                        "failed to start watcher",
                    );
                }
            }
        }
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }

    fn start_one(&self, repo_id: Uuid, repo_path: &Path) -> Result<ActiveWatch, String> {
        let git_dir = repo_path.join(".git");
        if !git_dir.exists() {
            return Err(format!("{} does not exist", git_dir.display()));
        }

        let (tx, mut rx) = mpsc::unbounded_channel::<()>();
        let tx_cb = tx.clone();

        let mut watcher = notify::recommended_watcher(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if interesting(&event) {
                        let _ = tx_cb.send(());
                    }
                }
            },
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(&git_dir, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        let app = self.app.clone();
        let payload = RepoChangedPayload {
            repo_id: repo_id.to_string(),
        };
        tauri::async_runtime::spawn(async move {
            while rx.recv().await.is_some() {
                tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)).await;
                // Coalesce any events that arrived during the debounce window.
                while rx.try_recv().is_ok() {}
                let _ = app.emit(REPO_CHANGED, payload.clone());
            }
        });

        Ok(ActiveWatch {
            _watcher: watcher,
            _sender: tx,
        })
    }
}

/// Filter notify events down to the ones that signal a user-visible git
/// state change. Path separators are normalized so the same matcher works
/// on Windows (backslashes) and POSIX (forward slashes).
fn interesting(event: &Event) -> bool {
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {}
        _ => return false,
    }
    event.paths.iter().any(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "HEAD" || name == "MERGE_HEAD" {
            return true;
        }
        let normalized = p.to_string_lossy().replace('\\', "/");
        normalized.contains("/refs/heads/")
    })
}
