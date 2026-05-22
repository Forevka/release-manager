use std::path::PathBuf;

use tauri::State;
use uuid::Uuid;

use crate::error::CommandErr;
use crate::state::AppState;

/// Watch every repository in the given group for `.git/` state changes.
/// Replaces any previously-watched set in one shot, so the frontend can
/// call this whenever the active group changes.
#[tauri::command]
pub async fn watch_group_repos(
    state: State<'_, AppState>,
    group_id: Uuid,
) -> Result<(), CommandErr> {
    let repos = rm_storage::repos::list_for_group(&state.db, group_id).await?;
    let wanted: Vec<(Uuid, PathBuf)> = repos
        .into_iter()
        .map(|r| (r.id, PathBuf::from(r.path)))
        .collect();
    state.watcher.set_watched(wanted);
    Ok(())
}

#[tauri::command]
pub async fn clear_watched_repos(state: State<'_, AppState>) -> Result<(), CommandErr> {
    state.watcher.clear();
    Ok(())
}
