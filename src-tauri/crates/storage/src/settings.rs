//! Non-secret settings: read/write into the `setting` key/value table.
//!
//! Used for Jira/GitLab URLs and similar config. Token *values* live in the
//! keychain via [`crate::SecretStore`]; this module only stores the URL/email.

use rm_core::{GitLabConnection, JiraConnection};
use sqlx::Row;

use crate::{secret::keys, Database, SecretStore, StorageError};

pub mod setting_keys {
    pub const JIRA_URL: &str = "jira_url";
    pub const JIRA_EMAIL: &str = "jira_email";
    pub const GITLAB_URL: &str = "gitlab_url";
    /// Absolute path to an executable that opens a repository directory for
    /// merge conflict resolution (e.g. GitHub Desktop). Spawned with the
    /// repo's local path as its only argument.
    pub const EXTERNAL_MERGE_TOOL: &str = "external_merge_tool_path";
}

async fn get_setting(db: &Database, key: &str) -> Result<Option<String>, StorageError> {
    let row = sqlx::query("SELECT value FROM setting WHERE key = ?1")
        .bind(key)
        .fetch_optional(db.pool())
        .await?;
    Ok(row.map(|r| r.get::<String, _>("value")))
}

async fn set_setting(db: &Database, key: &str, value: &str) -> Result<(), StorageError> {
    sqlx::query(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .execute(db.pool())
    .await?;
    Ok(())
}

pub async fn get_jira_connection(
    db: &Database,
    secrets: &SecretStore,
) -> Result<JiraConnection, StorageError> {
    let url = get_setting(db, setting_keys::JIRA_URL).await?.unwrap_or_default();
    let email = get_setting(db, setting_keys::JIRA_EMAIL).await?.unwrap_or_default();
    let token_set = secrets
        .has(keys::JIRA_TOKEN)
        .map_err(|e| StorageError::Conflict(format!("keychain: {e}")))?;
    Ok(JiraConnection { url, email, token_set })
}

/// Save Jira URL+email and (optionally) a new token. `token = None` means
/// "leave the existing token untouched", `Some("")` means "delete the token".
pub async fn save_jira_connection(
    db: &Database,
    secrets: &SecretStore,
    url: &str,
    email: &str,
    token: Option<&str>,
) -> Result<JiraConnection, StorageError> {
    set_setting(db, setting_keys::JIRA_URL, url).await?;
    set_setting(db, setting_keys::JIRA_EMAIL, email).await?;
    if let Some(t) = token {
        if t.is_empty() {
            secrets
                .delete(keys::JIRA_TOKEN)
                .map_err(|e| StorageError::Conflict(format!("keychain: {e}")))?;
        } else {
            secrets
                .set(keys::JIRA_TOKEN, t)
                .map_err(|e| StorageError::Conflict(format!("keychain: {e}")))?;
        }
    }
    get_jira_connection(db, secrets).await
}

pub async fn get_gitlab_connection(
    db: &Database,
    secrets: &SecretStore,
) -> Result<GitLabConnection, StorageError> {
    let url = get_setting(db, setting_keys::GITLAB_URL).await?.unwrap_or_default();
    let token_set = secrets
        .has(keys::GITLAB_TOKEN)
        .map_err(|e| StorageError::Conflict(format!("keychain: {e}")))?;
    Ok(GitLabConnection { url, token_set })
}

pub async fn get_external_merge_tool(db: &Database) -> Result<String, StorageError> {
    Ok(get_setting(db, setting_keys::EXTERNAL_MERGE_TOOL)
        .await?
        .unwrap_or_default())
}

pub async fn save_external_merge_tool(db: &Database, value: &str) -> Result<String, StorageError> {
    set_setting(db, setting_keys::EXTERNAL_MERGE_TOOL, value).await?;
    get_external_merge_tool(db).await
}

pub async fn save_gitlab_connection(
    db: &Database,
    secrets: &SecretStore,
    url: &str,
    token: Option<&str>,
) -> Result<GitLabConnection, StorageError> {
    set_setting(db, setting_keys::GITLAB_URL, url).await?;
    if let Some(t) = token {
        if t.is_empty() {
            secrets
                .delete(keys::GITLAB_TOKEN)
                .map_err(|e| StorageError::Conflict(format!("keychain: {e}")))?;
        } else {
            secrets
                .set(keys::GITLAB_TOKEN, t)
                .map_err(|e| StorageError::Conflict(format!("keychain: {e}")))?;
        }
    }
    get_gitlab_connection(db, secrets).await
}
