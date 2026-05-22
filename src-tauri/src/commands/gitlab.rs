use std::path::{Path, PathBuf};
use std::time::Duration;

use rm_core::GitLabProject;
use rm_gitlab::{GitLabClient, GitLabConfig};
use rm_storage::secret::keys;
use serde::Serialize;
use tauri::State;
use tokio::process::Command;

use crate::error::CommandErr;
use crate::state::AppState;

async fn gitlab_client(state: &AppState) -> Result<GitLabClient, CommandErr> {
    let conn = rm_storage::settings::get_gitlab_connection(&state.db, &state.secrets).await?;
    if conn.url.is_empty() {
        return Err(CommandErr(
            "GitLab URL not set — open Settings → Connections first".into(),
        ));
    }
    let token = state
        .secrets
        .get(keys::GITLAB_TOKEN)
        .map_err(|e| CommandErr(format!("keychain: {e}")))?
        .ok_or_else(|| {
            CommandErr(
                "GitLab token not set — open Settings → Connections and save a token".into(),
            )
        })?;
    GitLabClient::new(GitLabConfig {
        base_url: conn.url,
        token,
    })
    .map_err(|e| CommandErr(e.to_string()))
}

#[tauri::command]
pub async fn list_gitlab_group_projects(
    state: State<'_, AppState>,
    group_path: String,
    include_subgroups: bool,
) -> Result<Vec<GitLabProject>, CommandErr> {
    let client = gitlab_client(&state).await?;
    client
        .list_group_projects(&group_path, include_subgroups)
        .await
        .map_err(|e| CommandErr(e.to_string()))
}

/// Returns the local clone path for `project_path` under `base_dir`, if one
/// exists. Match rule: `<base_dir>/<project_path>` must exist and contain a
/// `.git` entry. Project paths with slashes (e.g. `devcom/atlas`) are tried
/// both as-is and with just the last segment so a flat checkout layout still
/// matches the typical GitLab subgroup-style path.
#[tauri::command]
pub async fn detect_local_clone(
    base_dir: String,
    project_path: String,
) -> Result<Option<String>, CommandErr> {
    let base = Path::new(&base_dir);
    let candidates: Vec<PathBuf> = {
        let mut v = vec![base.join(&project_path)];
        if let Some(leaf) = project_path.rsplit('/').next() {
            if leaf != project_path {
                v.push(base.join(leaf));
            }
        }
        v
    };
    for cand in candidates {
        if cand.is_dir() && cand.join(".git").exists() {
            return Ok(Some(cand.to_string_lossy().into_owned()));
        }
    }
    Ok(None)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneResult {
    pub target_path: String,
}

/// Clone `url` into `target_path`. Parent directory is created if missing.
/// Shells out to `git` so the user's SSH config + credential helper apply.
#[tauri::command]
pub async fn clone_project(
    url: String,
    target_path: String,
) -> Result<CloneResult, CommandErr> {
    let target = PathBuf::from(&target_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| CommandErr(format!("create parent dir: {e}")))?;
    }
    if target.exists() {
        return Err(CommandErr(format!(
            "target already exists: {target_path}"
        )));
    }

    let mut cmd = Command::new("git");
    cmd.arg("clone")
        .arg(&url)
        .arg(&target_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| CommandErr(format!("spawn git: {e} (is git on PATH?)")))?;

    // Generous timeout: cloning a large monorepo can take minutes.
    let output = tokio::time::timeout(Duration::from_secs(600), child.wait_with_output())
        .await
        .map_err(|_| CommandErr("clone exceeded 10 minutes".into()))?
        .map_err(|e| CommandErr(format!("wait: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let msg = if stderr.is_empty() {
            format!("git clone exited with status {}", output.status)
        } else {
            stderr
        };
        return Err(CommandErr(msg));
    }
    Ok(CloneResult { target_path })
}
