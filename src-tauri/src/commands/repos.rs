use rm_core::{NewRepository, Repository};
use rm_storage::repos;
use tauri::State;
use uuid::Uuid;

use crate::error::CommandErr;
use crate::state::AppState;

#[tauri::command]
pub async fn list_repositories(
    state: State<'_, AppState>,
    group_id: Uuid,
) -> Result<Vec<Repository>, CommandErr> {
    Ok(repos::list_for_group(&state.db, group_id).await?)
}

#[tauri::command]
pub async fn create_repository(
    state: State<'_, AppState>,
    input: NewRepository,
) -> Result<Repository, CommandErr> {
    Ok(repos::create(&state.db, input).await?)
}

#[tauri::command]
pub async fn update_repository(
    state: State<'_, AppState>,
    id: Uuid,
    input: NewRepository,
) -> Result<Repository, CommandErr> {
    Ok(repos::update(&state.db, id, input).await?)
}

#[tauri::command]
pub async fn delete_repository(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<(), CommandErr> {
    Ok(repos::delete(&state.db, id).await?)
}
