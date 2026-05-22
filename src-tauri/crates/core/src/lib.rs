//! Shared domain types for the release manager.
//!
//! These types are the IPC contract between the Rust backend and the React
//! frontend. All public types use `camelCase` field names over IPC so they
//! read naturally from TypeScript.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Phase 1 wiring proof (kept for the Health card)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreInfo {
    pub crate_name: &'static str,
    pub crate_version: &'static str,
}

impl CoreInfo {
    pub fn current() -> Self {
        Self {
            crate_name: env!("CARGO_PKG_NAME"),
            crate_version: env!("CARGO_PKG_VERSION"),
        }
    }
}

// ---------------------------------------------------------------------------
// Connections (Jira / GitLab) — secrets live in the OS keychain, never in IPC
// ---------------------------------------------------------------------------

/// Non-secret Jira connection info. The token, if any, is stored in the OS
/// keychain under (service="com.devcom.release-manager", username="jira_token").
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraConnection {
    pub url: String,
    pub email: String,
    /// True if a token is currently stored in the keychain. Never the value.
    pub token_set: bool,
}

/// Non-secret GitLab connection info. Token in keychain under
/// (service="com.devcom.release-manager", username="gitlab_token").
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabConnection {
    pub url: String,
    pub token_set: bool,
}

// ---------------------------------------------------------------------------
// Project groups + repositories
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroup {
    pub id: Uuid,
    pub name: String,
    /// Jira project key used to look up fixVersions and issues for this group.
    /// Optional so users can create git-only groups without Jira coupling.
    pub jira_project_key: Option<String>,
    pub default_release_branch: String,
    pub default_prod_branch: String,
    pub git_timeout_seconds: i32,
    pub max_retries: i32,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectGroup {
    pub name: String,
    pub jira_project_key: Option<String>,
    pub default_release_branch: String,
    pub default_prod_branch: String,
    pub git_timeout_seconds: i32,
    pub max_retries: i32,
}

impl Default for NewProjectGroup {
    fn default() -> Self {
        Self {
            name: String::new(),
            jira_project_key: None,
            default_release_branch: "UAT".into(),
            default_prod_branch: "main".into(),
            git_timeout_seconds: 60,
            max_retries: 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: Uuid,
    pub group_id: Uuid,
    pub name: String,
    pub path: String,
    /// `None` means "inherit from group's defaultReleaseBranch".
    pub release_branch: Option<String>,
    /// `None` means "inherit from group's defaultProdBranch".
    pub prod_branch: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRepository {
    pub group_id: Uuid,
    pub name: String,
    pub path: String,
    pub release_branch: Option<String>,
    pub prod_branch: Option<String>,
}

// ---------------------------------------------------------------------------
// Branch tags (mark branches broken/obsolete/not-needed/wip to skip merges)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BranchTagKind {
    Broken,
    NotNeeded,
    Obsolete,
    Wip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchTag {
    pub repo_id: Uuid,
    pub branch_name: String,
    pub kind: BranchTagKind,
    pub note: Option<String>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraVersion {
    pub id: String,
    pub name: String,
    pub released: bool,
    pub archived: bool,
    pub description: Option<String>,
    pub release_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub assignee: Option<String>,
}

// ---------------------------------------------------------------------------
// Release check result (per-repo × per-ticket)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BranchVerdict {
    /// Branch resolved and the feature commit is an ancestor of the target.
    Merged,
    /// Branch resolved but is not in the target's history yet.
    NotMerged,
    /// No branch matching this ticket key was found in the repo.
    NotFound,
    /// Branch resolved but the target branch itself could not be located.
    TargetMissing,
    /// Some other error occurred while checking this cell.
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCell {
    pub repo_id: Uuid,
    pub ticket_key: String,
    pub verdict: BranchVerdict,
    /// The exact branch name that was resolved (if any), e.g. "KEYS-123v2".
    pub resolved_branch: Option<String>,
    /// Number of commits in target that aren't in the feature branch.
    pub commits_behind: Option<i32>,
    /// Free-text detail (typically populated for Error / TargetMissing).
    pub note: Option<String>,
    /// True if the repository is currently in a merge state (MERGE_HEAD
    /// exists). Repo-wide, but stamped on each cell for IPC ergonomics — the
    /// frontend uses this to decide whether to keep showing a stale
    /// "conflict" override (merge still pending) or clear it (merge was
    /// resolved or aborted, the cell verdict now reflects reality).
    #[serde(default)]
    pub merge_in_progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCheckResult {
    pub group_id: Uuid,
    pub version_name: String,
    pub tickets: Vec<JiraIssue>,
    /// One [`BranchCell`] per (ticket, repo) pair, in ticket-then-repo order
    /// matching the input lists.
    pub cells: Vec<BranchCell>,
    pub checked_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// GitLab (phase 9)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProject {
    pub id: i64,
    /// Last path segment, e.g. "atlas".
    pub path: String,
    /// Full GitLab path, e.g. "devcom/atlas".
    pub path_with_namespace: String,
    pub name: String,
    pub default_branch: Option<String>,
    pub ssh_url_to_repo: String,
    pub http_url_to_repo: String,
    pub web_url: String,
    pub archived: bool,
}

// ---------------------------------------------------------------------------
// Merge outcomes (phase 4)
// ---------------------------------------------------------------------------

/// Result of attempting `git merge --no-ff <source>` after checking out the
/// target branch. Serializes as a discriminated union over IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum MergeOutcome {
    /// Merge committed cleanly. `commit` is the new HEAD SHA.
    Success { commit: String },
    /// Merge started but left the working tree in conflict state. The user
    /// must resolve externally (open-in-merge-tool / open-in-explorer).
    Conflict { message: String },
    /// Couldn't even check out the target — usually because the working
    /// tree has uncommitted changes that would be overwritten.
    DirtyWorkingTree { message: String },
    /// Catch-all for other git failures (missing remote, ref not found, etc.).
    Failed { message: String },
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntry {
    pub id: i64,
    pub occurred_at: DateTime<Utc>,
    pub actor: Option<String>,
    pub action: String,
    pub target_repo_id: Option<Uuid>,
    pub target_branch: Option<String>,
    pub outcome: AuditOutcome,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditOutcome {
    Success,
    Failure,
    Skipped,
}

// ---------------------------------------------------------------------------
// Changelog (phase 10)
// ---------------------------------------------------------------------------

/// A tag found in one or more repos of a project group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    /// Unix timestamp of the tagged commit (used for sort order). `None` for
    /// lightweight tags that point at objects without a date.
    pub date: Option<i64>,
}

/// A single commit after filtering and parsing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitEntry {
    pub sha: String,
    pub subject: String,
    pub author_email: String,
    pub repo_name: String,
    /// Extracted Jira ticket key (e.g. "KEYS-123"), if any.
    pub ticket_key: Option<String>,
    /// Conventional-commit type label as displayed (e.g. "Features", "Bug Fixes").
    pub commit_type: String,
    /// True if subject contains `!` (breaking change marker in CC spec).
    pub breaking: bool,
}

/// A group of commits under one display heading (e.g. "Features").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogSection {
    pub title: String,
    pub entries: Vec<CommitEntry>,
}

/// Statistics included at the bottom of every changelog.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogStats {
    pub total_analyzed: usize,
    pub total_included: usize,
    pub by_type: Vec<(String, usize)>,
    pub by_repo: Vec<(String, usize)>,
}

/// Full result returned by the `generate_changelog` Tauri command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogResult {
    pub version: String,
    pub sections: Vec<ChangelogSection>,
    pub stats: ChangelogStats,
    /// Ready-to-copy markdown string.
    pub markdown: String,
}

/// Per-repo tag override: used when a repo is missing the globally selected tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTagOverride {
    pub repo_id: Uuid,
    /// `None` means "skip this repo entirely".
    pub tag: Option<String>,
}

/// How to select commits for a changelog: tag range or date range.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChangelogRange {
    /// Commits reachable from `to_tag` but not from `from_tag`.
    Tags {
        from_tag: String,
        to_tag: String,
    },
    /// Commits on the group's default release branch within a calendar window.
    /// `until` is `None` = "now". Dates should be `YYYY-MM-DD`.
    Dates {
        since: String,
        until: Option<String>,
    },
}
