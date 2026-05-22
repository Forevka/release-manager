//! Local git operations on a repository checkout.
//!
//! - Read-only ops (branch resolution, merge-base, rev count) use libgit2.
//! - Network/mutation ops (fetch, checkout, merge) shell out to the user's
//!   `git` binary so we inherit their SSH keys, credential helper, GPG
//!   config, etc. — we don't reimplement libgit2 authentication.
//!
//! The branch-resolution rules deliberately mirror the Python TUI so the
//! verdicts match what users are already accustomed to.

use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

use git2::{BranchType, Oid, Repository};
use rm_core::{MergeOutcome, TagInfo};
use thiserror::Error;
use tokio::process::Command;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("git: {0}")]
    Git(#[from] git2::Error),
    #[error("repository not found at {0}")]
    NotFound(String),
    #[error("target branch not found: {0}")]
    TargetMissing(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("spawn git: {0} (is git on PATH?)")]
    Spawn(String),
}

#[derive(Debug, Clone)]
pub struct BranchMatch {
    /// Display name (`origin/` stripped for remote-only matches).
    pub name: String,
    pub is_local: bool,
    pub oid: Oid,
}

pub fn open(path: &Path) -> Result<Repository, GitError> {
    Repository::open(path).map_err(|_| GitError::NotFound(path.display().to_string()))
}

/// Resolve every branch matching a Jira ticket key, applying the TUI's rules
/// (locals first, dedupe with remotes, case-sensitive, accepts
/// `KEY` / `KEYv...` / `KEY-...`).
pub fn resolve_ticket_branch(repo: &Repository, key: &str) -> Result<Vec<BranchMatch>, GitError> {
    let mut out: Vec<BranchMatch> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    for kind in [BranchType::Local, BranchType::Remote] {
        let branches = repo.branches(Some(kind))?;
        for branch in branches {
            let (branch, _) = branch?;
            let raw_name = match branch.name()? {
                Some(n) => n,
                None => continue,
            };
            let name = if matches!(kind, BranchType::Remote) {
                let stripped = raw_name
                    .split_once('/')
                    .map(|(_, rest)| rest)
                    .unwrap_or(raw_name);
                if stripped == "HEAD" {
                    continue;
                }
                stripped.to_string()
            } else {
                raw_name.to_string()
            };

            if !matches_key(&name, key) {
                continue;
            }
            if seen.iter().any(|n| n == &name) {
                continue;
            }
            let oid = branch
                .get()
                .target()
                .ok_or_else(|| GitError::Git(git2::Error::from_str("branch has no target")))?;
            seen.push(name.clone());
            out.push(BranchMatch {
                name,
                is_local: matches!(kind, BranchType::Local),
                oid,
            });
        }
    }
    Ok(out)
}

fn matches_key(name: &str, key: &str) -> bool {
    if name == key {
        return true;
    }
    if name.starts_with(key) {
        let tail = &name[key.len()..];
        if let Some(c) = tail.chars().next() {
            return c == 'v' || c == '-';
        }
    }
    false
}

pub fn resolve_target(repo: &Repository, name: &str) -> Result<Oid, GitError> {
    if let Ok(b) = repo.find_branch(name, BranchType::Local) {
        if let Some(oid) = b.get().target() {
            return Ok(oid);
        }
    }
    let remote = format!("origin/{name}");
    if let Ok(b) = repo.find_branch(&remote, BranchType::Remote) {
        if let Some(oid) = b.get().target() {
            return Ok(oid);
        }
    }
    Err(GitError::TargetMissing(name.to_string()))
}

pub fn is_merged(repo: &Repository, branch_oid: Oid, target_oid: Oid) -> Result<bool, GitError> {
    if branch_oid == target_oid {
        return Ok(true);
    }
    match repo.merge_base(branch_oid, target_oid) {
        Ok(base) => Ok(base == branch_oid),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(false),
        Err(e) => Err(GitError::Git(e)),
    }
}

pub fn commits_behind(
    repo: &Repository,
    branch_oid: Oid,
    target_oid: Oid,
) -> Result<usize, GitError> {
    let mut walk = repo.revwalk()?;
    walk.push(target_oid)?;
    walk.hide(branch_oid)?;
    Ok(walk.count())
}

// ---------------------------------------------------------------------------
// Subprocess helpers (shell out to user's `git`)
// ---------------------------------------------------------------------------

/// Run `git -C <path> <args...>` with a hard timeout. Inherits the user's
/// environment so credentials/SSH/GPG/git config all just work, with
/// terminal prompts disabled so missing creds fail fast instead of hanging.
async fn run_git(path: &Path, args: &[&str], timeout: Duration) -> Result<Output, GitError> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path);
    for a in args {
        cmd.arg(a);
    }
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| GitError::Spawn(e.to_string()))?;

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(e)) => Err(GitError::Spawn(format!("wait failed: {e}"))),
        Err(_) => Err(GitError::Timeout(format!(
            "git {} exceeded {} seconds",
            args.join(" "),
            timeout.as_secs()
        ))),
    }
}

pub async fn fetch_all_remotes(repo_path: PathBuf, timeout: Duration) -> Result<(), GitError> {
    let output = run_git(&repo_path, &["fetch", "--all", "--prune"], timeout).await?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let msg = if stderr.is_empty() {
            format!("git fetch exited with status {}", output.status)
        } else {
            stderr
        };
        Err(GitError::Git(git2::Error::from_str(&msg)))
    }
}

/// Merge `source` into `target` with `--no-ff`. Checks out target first.
/// Resolves `source` to a local branch if one exists, else to `origin/source`.
/// List all tags in the repo sorted by creator-date descending (newest first).
/// Returns `(tag_name, unix_timestamp_or_None)` pairs.
pub async fn list_tags_for_repo(repo_path: PathBuf) -> Result<Vec<TagInfo>, GitError> {
    let output = run_git(
        &repo_path,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)\t%(creatordate:unix)",
            "refs/tags/",
        ],
        Duration::from_secs(10),
    )
    .await?;

    if !output.status.success() {
        // Missing tags is not an error; just return empty.
        return Ok(vec![]);
    }

    let out = String::from_utf8_lossy(&output.stdout);
    let mut tags = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((name, ts)) = line.split_once('\t') {
            let date = ts.trim().parse::<i64>().ok();
            tags.push(TagInfo { name: name.to_string(), date });
        } else {
            tags.push(TagInfo { name: line.to_string(), date: None });
        }
    }
    Ok(tags)
}

/// Returns raw commit lines reachable from `branch` within a date window.
/// `since` / `until` are any format git accepts (e.g. `"2024-01-01"`).
/// `until = None` means "now".
pub async fn get_commits_since_until(
    repo_path: PathBuf,
    branch: &str,
    since: &str,
    until: Option<&str>,
) -> Result<Vec<(String, String, String)>, GitError> {
    let since_arg = format!("--since={since}");
    let until_arg = until.map(|u| format!("--until={u}"));
    let mut args = vec!["log", branch, "--format=%H\x1f%s\x1f%ae", &since_arg];
    if let Some(ref u) = until_arg {
        args.push(u.as_str());
    }
    let output = run_git(&repo_path, &args, Duration::from_secs(60)).await?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(3, '\x1f').collect();
        if parts.len() == 3 {
            commits.push((parts[0].to_string(), parts[1].to_string(), parts[2].to_string()));
        }
    }
    Ok(commits)
}

/// Returns raw commit lines for `from_ref..to_ref` without any filtering.
/// Each entry is `(sha, subject, author_email)`. The caller does filtering.
///
/// `to_ref` may be `"HEAD"` to capture up to the current commit.
pub async fn get_commits_between(
    repo_path: PathBuf,
    from_ref: &str,
    to_ref: &str,
) -> Result<Vec<(String, String, String)>, GitError> {
    let range = format!("{from_ref}..{to_ref}");
    // Unit-separator (0x1F) as field delimiter; unlikely to appear in commit messages.
    let output = run_git(
        &repo_path,
        &["log", &range, "--format=%H\x1f%s\x1f%ae"],
        Duration::from_secs(30),
    )
    .await?;

    // If the range is invalid (missing tag) treat as no commits rather than error.
    if !output.status.success() {
        return Ok(vec![]);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.splitn(3, '\x1f').collect();
        if parts.len() == 3 {
            commits.push((
                parts[0].to_string(),
                parts[1].to_string(),
                parts[2].to_string(),
            ));
        }
    }
    Ok(commits)
}

pub async fn merge_into_target(
    repo_path: PathBuf,
    source: String,
    target: String,
    timeout: Duration,
) -> Result<MergeOutcome, GitError> {
    // libgit2 ref resolution is sync; cheap.
    let resolved = {
        let path = repo_path.clone();
        let src = source.clone();
        tokio::task::spawn_blocking(move || -> Result<String, GitError> {
            let repo = open(&path)?;
            if repo.find_branch(&src, BranchType::Local).is_ok() {
                return Ok(src);
            }
            let remote = format!("origin/{src}");
            if repo.find_branch(&remote, BranchType::Remote).is_ok() {
                return Ok(remote);
            }
            Err(GitError::TargetMissing(src))
        })
        .await
        .map_err(|e| GitError::Spawn(format!("join: {e}")))??
    };

    // 1) Checkout the target branch.
    let checkout = run_git(&repo_path, &["checkout", &target], timeout).await?;
    if !checkout.status.success() {
        let stderr = String::from_utf8_lossy(&checkout.stderr).to_string();
        let lower = stderr.to_lowercase();
        if lower.contains("would be overwritten")
            || lower.contains("local changes")
            || lower.contains("uncommitted")
            || lower.contains("untracked working tree")
        {
            return Ok(MergeOutcome::DirtyWorkingTree { message: stderr });
        }
        return Ok(MergeOutcome::Failed {
            message: format!("checkout {target} failed: {stderr}"),
        });
    }

    // 2) Merge with --no-ff (matches TUI). On conflict, leave the working
    //    tree as-is so the user can resolve externally.
    let merge = run_git(&repo_path, &["merge", "--no-ff", &resolved], timeout).await?;
    let stdout = String::from_utf8_lossy(&merge.stdout).to_string();
    let stderr = String::from_utf8_lossy(&merge.stderr).to_string();

    if merge.status.success() {
        let head = run_git(&repo_path, &["rev-parse", "HEAD"], timeout).await?;
        let commit = String::from_utf8_lossy(&head.stdout).trim().to_string();
        return Ok(MergeOutcome::Success { commit });
    }

    let combined = format!("{stdout}\n{stderr}").trim().to_string();
    if combined.to_lowercase().contains("conflict") {
        Ok(MergeOutcome::Conflict { message: combined })
    } else {
        Ok(MergeOutcome::Failed { message: combined })
    }
}
