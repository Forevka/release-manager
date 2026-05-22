use rm_core::{NewProjectGroup, ProjectGroup};
use rm_storage::groups;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandErr;
use crate::state::AppState;

#[tauri::command]
pub async fn list_groups(state: State<'_, AppState>) -> Result<Vec<ProjectGroup>, CommandErr> {
    Ok(groups::list(&state.db).await?)
}

#[tauri::command]
pub async fn create_group(
    state: State<'_, AppState>,
    input: NewProjectGroup,
) -> Result<ProjectGroup, CommandErr> {
    Ok(groups::create(&state.db, input).await?)
}

#[tauri::command]
pub async fn update_group(
    state: State<'_, AppState>,
    id: Uuid,
    input: NewProjectGroup,
) -> Result<ProjectGroup, CommandErr> {
    Ok(groups::update(&state.db, id, input).await?)
}

#[tauri::command]
pub async fn delete_group(state: State<'_, AppState>, id: Uuid) -> Result<(), CommandErr> {
    Ok(groups::delete(&state.db, id).await?)
}
