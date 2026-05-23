use rm_core::{BranchTag, BranchTagKind};
use rm_storage::branch_tags;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandErr;
use crate::state::AppState;

/// Upsert or delete a branch tag.
/// `kind = None` clears the tag; `kind = Some(...)` sets it.
#[tauri::command]
pub async fn set_branch_tag(
    state: State<'_, AppState>,
    repo_id: Uuid,
    branch_name: String,
    kind: Option<BranchTagKind>,
    note: Option<String>,
) -> Result<Option<BranchTag>, CommandErr> {
    match kind {
        None => {
            branch_tags::clear(&state.db, repo_id, &branch_name).await?;
            Ok(None)
        }
        Some(k) => {
            let tag = branch_tags::upsert(
                &state.db,
                repo_id,
                &branch_name,
                &k,
                note.as_deref(),
            )
            .await?;
            Ok(Some(tag))
        }
    }
}

/// List all branch tags for a repository.
#[tauri::command]
pub async fn list_branch_tags(
    state: State<'_, AppState>,
    repo_id: Uuid,
) -> Result<Vec<BranchTag>, CommandErr> {
    Ok(branch_tags::list_for_repo(&state.db, repo_id).await?)
}
