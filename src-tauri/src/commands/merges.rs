use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rm_core::MergeOutcome;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandErr;
use crate::state::AppState;

/// Merge `source` into the repo's release branch (or per-repo override).
/// Returns a [`MergeOutcome`] tagged union the frontend can switch on.
#[tauri::command]
pub async fn merge_branch(
    state: State<'_, AppState>,
    repo_id: Uuid,
    source: String,
) -> Result<MergeOutcome, CommandErr> {
    let repo = rm_storage::repos::get(&state.db, repo_id).await?;
    let group = rm_storage::groups::get(&state.db, repo.group_id).await?;
    let target = repo
        .release_branch
        .clone()
        .unwrap_or(group.default_release_branch);
    let timeout = Duration::from_secs(group.git_timeout_seconds.max(1) as u64);
    let path = PathBuf::from(&repo.path);

    rm_git_ops::merge_into_target(path, source, target, timeout)
        .await
        .map_err(|e| CommandErr(e.to_string()))
}

/// Open the repository folder in the OS file manager (Explorer on Windows).
#[tauri::command]
pub async fn open_in_explorer(
    state: State<'_, AppState>,
    repo_id: Uuid,
) -> Result<(), CommandErr> {
    let repo = rm_storage::repos::get(&state.db, repo_id).await?;
    spawn_explorer(Path::new(&repo.path))
}

/// Spawn the configured external merge tool against the repository path.
/// Falls back to opening the folder in Explorer if no tool is configured.
#[tauri::command]
pub async fn open_in_merge_tool(
    state: State<'_, AppState>,
    repo_id: Uuid,
) -> Result<(), CommandErr> {
    let repo = rm_storage::repos::get(&state.db, repo_id).await?;
    let tool = rm_storage::settings::get_external_merge_tool(&state.db).await?;
    let tool = tool.trim();
    if tool.is_empty() {
        return spawn_explorer(Path::new(&repo.path));
    }
    Command::new(tool)
        .arg(&repo.path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandErr(format!("could not launch merge tool ({tool}): {e}")))
}

#[tauri::command]
pub async fn get_external_merge_tool(state: State<'_, AppState>) -> Result<String, CommandErr> {
    Ok(rm_storage::settings::get_external_merge_tool(&state.db).await?)
}

#[tauri::command]
pub async fn save_external_merge_tool(
    state: State<'_, AppState>,
    value: String,
) -> Result<String, CommandErr> {
    Ok(rm_storage::settings::save_external_merge_tool(&state.db, &value).await?)
}

fn spawn_explorer(path: &Path) -> Result<(), CommandErr> {
    Command::new("explorer")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandErr(format!("could not launch explorer: {e}")))
}
