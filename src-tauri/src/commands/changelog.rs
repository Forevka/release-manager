use rm_core::{ChangelogRange, ChangelogResult, RepoTagOverride, TagInfo};
use rm_release_engine::changelog::{self, ChangelogInput};
use rm_storage::settings;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandErr;
use crate::state::AppState;

#[tauri::command]
pub async fn list_group_tags(
    state: State<'_, AppState>,
    group_id: Uuid,
) -> Result<Vec<TagInfo>, CommandErr> {
    let repos = rm_storage::repos::list_for_group(&state.db, group_id).await?;
    Ok(changelog::collect_group_tags(&repos).await)
}

#[tauri::command]
pub async fn generate_changelog(
    state: State<'_, AppState>,
    group_id: Uuid,
    range: ChangelogRange,
    version: String,
    tag_overrides: Vec<RepoTagOverride>,
) -> Result<ChangelogResult, CommandErr> {
    let group = rm_storage::groups::get(&state.db, group_id).await?;
    let repos = rm_storage::repos::list_for_group(&state.db, group_id).await?;
    let jira_conn = settings::get_jira_connection(&state.db, &state.secrets).await?;
    let jira_url = if jira_conn.url.is_empty() { None } else { Some(jira_conn.url) };

    Ok(changelog::generate_changelog(ChangelogInput {
        version: &version,
        range: &range,
        default_release_branch: &group.default_release_branch,
        repos: &repos,
        tag_overrides: &tag_overrides,
        jira_url: jira_url.as_deref(),
    })
    .await)
}
