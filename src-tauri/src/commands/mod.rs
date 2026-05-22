//! Tauri commands exposed to the frontend.
//!
//! Each command is a thin wrapper that delegates to a workspace crate. The
//! AppState (Database + SecretStore) is injected via [`tauri::State`].
//!
//! Note: `tauri::generate_handler!` resolves to macro-generated sibling items
//! next to each `#[tauri::command]` function, so the registration in `lib.rs`
//! references the submodules directly (`commands::settings::save_jira_connection`)
//! rather than going through `pub use` re-exports.

pub mod health;
pub mod settings;
pub mod groups;
pub mod repos;
pub mod releases;
pub mod merges;
pub mod watch;
pub mod gitlab;
pub mod changelog;
