//! Cross-repo orchestration for the release check.
//!
//! The main entry point is [`check_release`]. It pulls the issue list from
//! Jira once, then for each repo opens the working tree (off the tokio
//! runtime via `spawn_blocking`, since libgit2 is sync) and resolves every
//! ticket key in parallel.
//!
//! Callers can pass an optional [`ProgressSink`] callback that's invoked
//! once per repo as its check completes — the Tauri layer uses this to
//! drive the activity-bar progress UI without coupling the engine to any
//! particular UI / event system.

pub mod changelog;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use chrono::Utc;
use futures::future::join_all;
use rm_core::{
    BranchCell, BranchVerdict, JiraIssue, ProjectGroup, ReleaseCheckResult, Repository as RepoEntry,
};
use rm_git_ops as git_ops;
use rm_jira::{JiraClient, JiraError};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("jira: {0}")]
    Jira(#[from] JiraError),
    #[error("group has no Jira project key configured")]
    NoJiraKey,
}

/// Called after each per-repo check finishes. Arguments: (done, total, repo_name).
pub type ProgressSink = Arc<dyn Fn(u32, u32, &str) + Send + Sync>;

pub async fn list_versions_for_group(
    jira: &JiraClient,
    group: &ProjectGroup,
) -> Result<Vec<rm_core::JiraVersion>, EngineError> {
    let key = group
        .jira_project_key
        .as_ref()
        .ok_or(EngineError::NoJiraKey)?;
    Ok(jira.list_versions(key).await?)
}

pub async fn check_release(
    jira: &JiraClient,
    group: &ProjectGroup,
    version_name: &str,
    repos: Vec<RepoEntry>,
    progress: Option<ProgressSink>,
) -> Result<ReleaseCheckResult, EngineError> {
    let jira_key = group
        .jira_project_key
        .as_ref()
        .ok_or(EngineError::NoJiraKey)?;

    let tickets = jira.list_issues_in_version(jira_key, version_name).await?;
    let release_branch_default = group.default_release_branch.clone();

    let total = repos.len() as u32;
    let counter = Arc::new(AtomicU32::new(0));

    let mut per_repo_futures = Vec::with_capacity(repos.len());
    for repo in repos {
        let tickets = tickets.clone();
        let target = repo
            .release_branch
            .clone()
            .unwrap_or_else(|| release_branch_default.clone());
        let repo_id = repo.id;
        let repo_name = repo.name.clone();
        let path: PathBuf = PathBuf::from(&repo.path);
        let counter = counter.clone();
        let progress = progress.clone();

        per_repo_futures.push(async move {
            let cells = tokio::task::spawn_blocking(move || {
                check_repo(repo_id, path, target, tickets)
            })
            .await;
            let done = counter.fetch_add(1, Ordering::SeqCst) + 1;
            if let Some(ref cb) = progress {
                cb(done, total, &repo_name);
            }
            cells
        });
    }

    let mut cells: Vec<BranchCell> = Vec::new();
    for handle in join_all(per_repo_futures).await {
        match handle {
            Ok(repo_cells) => cells.extend(repo_cells),
            Err(join_err) => {
                tracing::error!(error = %join_err, "release check task panicked");
            }
        }
    }

    Ok(ReleaseCheckResult {
        group_id: group.id,
        version_name: version_name.to_string(),
        tickets,
        cells,
        checked_at: Utc::now(),
    })
}

/// Public per-repo recheck used by `check_release` and by the
/// `recheck_repo_cells` Tauri command. Opens the repo once and resolves
/// every ticket key in `keys` against the target branch.
pub fn check_tickets_in_repo(
    repo_id: Uuid,
    path: PathBuf,
    target_branch: String,
    keys: Vec<String>,
) -> Vec<BranchCell> {
    let repo = match git_ops::open(&path) {
        Ok(r) => r,
        Err(e) => {
            return keys
                .into_iter()
                .map(|k| BranchCell {
                    repo_id,
                    ticket_key: k,
                    verdict: BranchVerdict::Error,
                    resolved_branch: None,
                    commits_behind: None,
                    note: Some(format!("repo open failed: {e}")),
                    merge_in_progress: false,
                })
                .collect();
        }
    };

    let merge_in_progress = repo.state() == git2::RepositoryState::Merge;

    let target_oid = match git_ops::resolve_target(&repo, &target_branch) {
        Ok(oid) => oid,
        Err(_) => {
            return keys
                .into_iter()
                .map(|k| BranchCell {
                    repo_id,
                    ticket_key: k,
                    verdict: BranchVerdict::TargetMissing,
                    resolved_branch: None,
                    commits_behind: None,
                    note: Some(format!("target branch '{target_branch}' not found")),
                    merge_in_progress,
                })
                .collect();
        }
    };

    keys.into_iter()
        .map(|k| {
            let mut cell = check_one_ticket(&repo, repo_id, target_oid, &k);
            cell.merge_in_progress = merge_in_progress;
            cell
        })
        .collect()
}

/// Single-cell evaluation: branch resolution + merge-base check + commits
/// behind. Reused by `check_tickets_in_repo` and by anything that wants to
/// refresh a single (repo, ticket) pair.
pub fn check_one_ticket(
    repo: &git2::Repository,
    repo_id: Uuid,
    target_oid: git2::Oid,
    key: &str,
) -> BranchCell {
    let matches = match git_ops::resolve_ticket_branch(repo, key) {
        Ok(m) => m,
        Err(e) => {
            return BranchCell {
                repo_id,
                ticket_key: key.to_string(),
                verdict: BranchVerdict::Error,
                resolved_branch: None,
                commits_behind: None,
                note: Some(e.to_string()),
                merge_in_progress: false,
            };
        }
    };
    if matches.is_empty() {
        return BranchCell {
            repo_id,
            ticket_key: key.to_string(),
            verdict: BranchVerdict::NotFound,
            resolved_branch: None,
            commits_behind: None,
            note: None,
            merge_in_progress: false,
        };
    }
    let exact = matches.iter().find(|m| m.name == key);
    let chosen = exact.cloned().unwrap_or_else(|| {
        matches
            .iter()
            .find(|m| git_ops::is_merged(repo, m.oid, target_oid).unwrap_or(false))
            .cloned()
            .unwrap_or_else(|| matches[0].clone())
    });

    let merged = git_ops::is_merged(repo, chosen.oid, target_oid).unwrap_or(false);
    let commits_behind = git_ops::commits_behind(repo, chosen.oid, target_oid)
        .ok()
        .map(|n| n as i32);
    BranchCell {
        repo_id,
        ticket_key: key.to_string(),
        verdict: if merged {
            BranchVerdict::Merged
        } else {
            BranchVerdict::NotMerged
        },
        resolved_branch: Some(chosen.name),
        commits_behind,
        note: None,
        // Populated by `check_tickets_in_repo`. Single-cell callers don't
        // currently expose merge-in-progress; default to false here.
        merge_in_progress: false,
    }
}

fn check_repo(
    repo_id: Uuid,
    path: PathBuf,
    target_branch: String,
    tickets: Vec<JiraIssue>,
) -> Vec<BranchCell> {
    let keys = tickets.into_iter().map(|t| t.key).collect();
    check_tickets_in_repo(repo_id, path, target_branch, keys)
}
