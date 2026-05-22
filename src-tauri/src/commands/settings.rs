use rm_core::{GitLabConnection, JiraConnection};
use rm_storage::settings;
use tauri::State;

use crate::error::CommandErr;
use crate::state::AppState;

#[tauri::command]
pub async fn get_jira_connection(state: State<'_, AppState>) -> Result<JiraConnection, CommandErr> {
    Ok(settings::get_jira_connection(&state.db, &state.secrets).await?)
}

/// `token = None` (omitted/null on the JS side) leaves the existing token
/// untouched. `Some("")` deletes it. Any other value replaces it.
#[tauri::command]
pub async fn save_jira_connection(
    state: State<'_, AppState>,
    url: String,
    email: String,
    token: Option<String>,
) -> Result<JiraConnection, CommandErr> {
    Ok(settings::save_jira_connection(
        &state.db,
        &state.secrets,
        &url,
        &email,
        token.as_deref(),
    )
    .await?)
}

#[tauri::command]
pub async fn get_gitlab_connection(state: State<'_, AppState>) -> Result<GitLabConnection, CommandErr> {
    Ok(settings::get_gitlab_connection(&state.db, &state.secrets).await?)
}

#[tauri::command]
pub async fn save_gitlab_connection(
    state: State<'_, AppState>,
    url: String,
    token: Option<String>,
) -> Result<GitLabConnection, CommandErr> {
    Ok(settings::save_gitlab_connection(
        &state.db,
        &state.secrets,
        &url,
        token.as_deref(),
    )
    .await?)
}
