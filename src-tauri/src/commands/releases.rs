use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::StreamExt;
use rm_core::{BranchCell, JiraVersion, ReleaseCheckResult};
use rm_jira::{JiraClient, JiraConfig};
use rm_storage::secret::keys;
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::error::CommandErr;
use crate::events::{emit_log, emit_progress, TaskLogLevel};
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFetchResult {
    pub repo_id: Uuid,
    pub success: bool,
    pub error: Option<String>,
}

async fn jira_client(state: &AppState) -> Result<JiraClient, CommandErr> {
    let conn = rm_storage::settings::get_jira_connection(&state.db, &state.secrets).await?;
    if conn.url.is_empty() || conn.email.is_empty() {
        return Err(CommandErr(
            "Jira URL and email must be set in Settings → Connections first".into(),
        ));
    }
    let token = state
        .secrets
        .get(keys::JIRA_TOKEN)
        .map_err(|e| CommandErr(format!("keychain: {e}")))?
        .ok_or_else(|| {
            CommandErr(
                "Jira token not set — open Settings → Connections and save a token".into(),
            )
        })?;
    JiraClient::new(JiraConfig {
        base_url: conn.url,
        email: conn.email,
        token,
    })
    .map_err(|e| CommandErr(e.to_string()))
}

#[tauri::command]
pub async fn list_jira_versions(
    state: State<'_, AppState>,
    group_id: Uuid,
) -> Result<Vec<JiraVersion>, CommandErr> {
    let group = rm_storage::groups::get(&state.db, group_id).await?;
    let key = group
        .jira_project_key
        .as_ref()
        .ok_or_else(|| CommandErr("group has no Jira project key configured".into()))?;
    let client = jira_client(&state).await?;
    client
        .list_versions(key)
        .await
        .map_err(|e| CommandErr(e.to_string()))
}

#[tauri::command]
pub async fn check_release(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: Uuid,
    version_name: String,
    task_id: Option<String>,
) -> Result<ReleaseCheckResult, CommandErr> {
    let group = rm_storage::groups::get(&state.db, group_id).await?;
    let repos = rm_storage::repos::list_for_group(&state.db, group_id).await?;
    let client = jira_client(&state).await?;

    let progress = task_id.as_ref().map(|tid| {
        let app = app.clone();
        let tid = tid.clone();
        let sink: rm_release_engine::ProgressSink = Arc::new(move |done, total, repo_name| {
            emit_progress(&app, &tid, done, total);
            emit_log(
                &app,
                &tid,
                TaskLogLevel::Info,
                format!("checked {repo_name}"),
            );
        });
        sink
    });

    rm_release_engine::check_release(&client, &group, &version_name, repos, progress)
        .await
        .map_err(|e| CommandErr(e.to_string()))
}

/// Re-evaluate the listed ticket cells for one repo. Cheap compared to
/// `check_release` — no Jira call, no fan-out across other repos. Used by
/// the auto-recheck flow (file watcher fires → frontend asks us to refresh
/// the affected repo) and by the per-row Recheck button.
#[tauri::command]
pub async fn recheck_repo_cells(
    state: State<'_, AppState>,
    group_id: Uuid,
    repo_id: Uuid,
    ticket_keys: Vec<String>,
) -> Result<Vec<BranchCell>, CommandErr> {
    let group = rm_storage::groups::get(&state.db, group_id).await?;
    let repo = rm_storage::repos::get(&state.db, repo_id).await?;
    if repo.group_id != group_id {
        return Err(CommandErr(
            "repository does not belong to the given group".into(),
        ));
    }
    let target = repo
        .release_branch
        .clone()
        .unwrap_or(group.default_release_branch);
    let path = PathBuf::from(&repo.path);

    let cells = tokio::task::spawn_blocking(move || {
        rm_release_engine::check_tickets_in_repo(repo_id, path, target, ticket_keys)
    })
    .await
    .map_err(|e| CommandErr(format!("recheck task panicked: {e}")))?;
    Ok(cells)
}

#[tauri::command]
pub async fn fetch_repos(
    app: AppHandle,
    state: State<'_, AppState>,
    group_id: Uuid,
    task_id: Option<String>,
) -> Result<Vec<RepoFetchResult>, CommandErr> {
    let group = rm_storage::groups::get(&state.db, group_id).await?;
    let repos = rm_storage::repos::list_for_group(&state.db, group_id).await?;
    let timeout = Duration::from_secs(group.git_timeout_seconds.max(1) as u64);
    let total = repos.len() as u32;
    let counter = Arc::new(AtomicU32::new(0));

    if let Some(ref tid) = task_id {
        emit_progress(&app, tid, 0, total);
    }

    // Cap how many `git fetch` processes hit the remote at once. Firing all
    // repos in a large group concurrently floods the host's SSH daemon and
    // gets connections dropped ("kex_exchange_identification: Connection
    // closed by remote host"), so we keep at most 5 fetches in flight.
    const FETCH_CONCURRENCY: usize = 5;

    let handles = repos.into_iter().map(|r| {
        let path = PathBuf::from(&r.path);
        let id = r.id;
        let name = r.name.clone();
        let counter = counter.clone();
        let app = app.clone();
        let tid = task_id.clone();
        async move {
            let result = rm_git_ops::fetch_all_remotes(path, timeout).await;
            let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
            if let Some(ref tid) = tid {
                emit_progress(&app, tid, done, total);
                match &result {
                    Ok(_) => emit_log(
                        &app,
                        tid,
                        TaskLogLevel::Success,
                        format!("{name}: fetched"),
                    ),
                    Err(e) => emit_log(
                        &app,
                        tid,
                        TaskLogLevel::Error,
                        format!("{name}: {e}"),
                    ),
                }
            }
            RepoFetchResult {
                repo_id: id,
                success: result.is_ok(),
                error: result.err().map(|e| e.to_string()),
            }
        }
    });
    let results = futures::stream::iter(handles)
        .buffer_unordered(FETCH_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
    Ok(results)
}
