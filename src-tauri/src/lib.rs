mod commands;
mod error;
mod events;
mod state;
mod watcher;

use rm_storage::{Database, SecretStore};
use tauri::Manager;

use crate::state::AppState;
use crate::watcher::WatcherManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("resolving app_data_dir");
            let db = tauri::async_runtime::block_on(Database::open(&app_dir))
                .expect("opening sqlite database");
            let watcher = WatcherManager::new(app.handle().clone());
            app.manage(AppState {
                db,
                secrets: SecretStore::new(),
                watcher,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::ping,
            commands::settings::get_jira_connection,
            commands::settings::save_jira_connection,
            commands::settings::get_gitlab_connection,
            commands::settings::save_gitlab_connection,
            commands::groups::list_groups,
            commands::groups::create_group,
            commands::groups::update_group,
            commands::groups::delete_group,
            commands::repos::list_repositories,
            commands::repos::create_repository,
            commands::repos::update_repository,
            commands::repos::delete_repository,
            commands::releases::list_jira_versions,
            commands::releases::check_release,
            commands::releases::fetch_repos,
            commands::releases::recheck_repo_cells,
            commands::merges::merge_branch,
            commands::merges::open_in_explorer,
            commands::merges::open_in_merge_tool,
            commands::merges::get_external_merge_tool,
            commands::merges::save_external_merge_tool,
            commands::watch::watch_group_repos,
            commands::watch::clear_watched_repos,
            commands::gitlab::list_gitlab_group_projects,
            commands::gitlab::detect_local_clone,
            commands::gitlab::clone_project,
            commands::changelog::list_group_tags,
            commands::changelog::generate_changelog,
            commands::branch_tags::set_branch_tag,
            commands::branch_tags::list_branch_tags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
