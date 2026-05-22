//! Changelog generation from git commit history.
//!
//! Ports the filtering rules, conventional-commit parsing, deduplication,
//! and markdown rendering from the Python TUI's `changelog_generator.py`
//! as faithfully as possible so the output format matches what teams are
//! used to.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::{Regex, RegexSet};
use rm_core::{
    ChangelogRange, ChangelogResult, ChangelogSection, ChangelogStats, CommitEntry, RepoTagOverride,
    Repository, TagInfo,
};

// ---------------------------------------------------------------------------
// Pattern sets — compiled once at first use
// ---------------------------------------------------------------------------

/// Commits whose subject matches any of these are silently dropped.
static SKIP_SET: Lazy<RegexSet> = Lazy::new(|| {
    RegexSet::new([
        r"(?i)^Merge branch .+ into .+",
        r"(?i)^Merge pull request .+",
        r"(?i)^Merged .+ into .+",
        r"(?i)^Merge remote-tracking branch .+",
        r"(?i)^Merge\s+[A-Z]+-\d+",
        r"(?i)^Marge\s+[A-Z]+-\d+",
        r#"(?i)^Revert "?.+"?"#,
        r"(?i)^Reverted .+",
        r"(?i)^fixed issue after merging$",
        r"(?i)^Updated merge request .+",
        r"(?i)^.+ inserted into .+",
        r"(?i)^Comit [A-Z]+-\d+",
    ])
    .expect("SKIP_SET patterns are valid")
});

/// Commits whose subject matches any of these are dropped as boilerplate.
static BOILERPLATE_SET: Lazy<RegexSet> = Lazy::new(|| {
    RegexSet::new([
        r"(?i)^updated? references?$",
        r"(?i)^updated? common$",
        r"(?i)^update common$",
        r"(?i)^updated? submodule",
        r"(?i)^bump version",
        r"(?i)^version bump",
        r"(?i)^cherry picked from",
        r"(?i)^cherry-picked from",
        r"(?i)^fixed merge conflicts?$",
        r"(?i)^fixed bad merge$",
        r"(?i)^resolved conflicts",
        r"(?i)^typo fix$",
        r"(?i)^minor fix$",
        r"(?i)^small refactor$",
        r"(?i)^formatting fix",
        r"(?i)^removed unnecessary",
        r"(?i)^fixed usings after merge$",
        r"(?i)^Update .+\.(cs|csproj|sln)$",
        r"(?i)^testing$",
        r"(?i)^testing x\d+",
        r"(?i)^fonts fix$",
        r"(?i)^fix duplicates$",
        r"(?i)^fix merge duplicates$",
    ])
    .expect("BOILERPLATE_SET patterns are valid")
});

/// Matches a Jira-style ticket key anywhere in the subject.
static JIRA_TICKET: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Z]{2,10}-\d+").expect("JIRA_TICKET pattern is valid"));

/// Matches a conventional commit prefix: `type(scope)?!?: description`.
static CC_PREFIX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\([^)]*\))?(!)?:\s+(.+)")
        .expect("CC_PREFIX pattern is valid")
});

// ---------------------------------------------------------------------------
// Type → display label mapping (ordered for output)
// ---------------------------------------------------------------------------

fn cc_type_label(ty: &str) -> &'static str {
    match ty {
        "feat" => "Features",
        "fix" => "Bug Fixes",
        "perf" => "Performance",
        "refactor" => "Refactoring",
        "docs" => "Documentation",
        "test" => "Testing",
        "build" => "Build",
        "ci" => "CI/CD",
        "style" => "Style",
        "chore" => "Chores",
        _ => "Other",
    }
}

const SECTION_ORDER: &[&str] = &[
    "Breaking Changes",
    "Features",
    "Bug Fixes",
    "Performance",
    "Refactoring",
    "Documentation",
    "Testing",
    "Build",
    "CI/CD",
    "Style",
    "Chores",
    "Other",
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

pub struct ChangelogInput<'a> {
    pub version: &'a str,
    pub range: &'a ChangelogRange,
    /// The group's default release branch — used only for date-range mode.
    pub default_release_branch: &'a str,
    pub repos: &'a [Repository],
    pub tag_overrides: &'a [RepoTagOverride],
    /// Base URL for Jira issue links. `None` → plain ticket keys.
    pub jira_url: Option<&'a str>,
}

/// Collect commits from all repos, filter, parse, deduplicate, and render.
pub async fn generate_changelog(input: ChangelogInput<'_>) -> ChangelogResult {
    let mut all_raw: Vec<(String, String, String, String)> = Vec::new(); // (sha, subject, email, repo_name)

    match input.range {
        ChangelogRange::Tags { from_tag, to_tag } => {
            let override_map: HashMap<uuid::Uuid, Option<String>> = input
                .tag_overrides
                .iter()
                .map(|o| (o.repo_id, o.tag.clone()))
                .collect();

            for repo in input.repos {
                let from = from_tag.as_str();
                let to = match override_map.get(&repo.id) {
                    Some(Some(t)) => t.as_str(),
                    Some(None) => continue,
                    None => to_tag.as_str(),
                };
                if from == to {
                    continue;
                }
                match rm_git_ops::get_commits_between(PathBuf::from(&repo.path), from, to).await {
                    Ok(commits) => {
                        for (sha, subject, email) in commits {
                            all_raw.push((sha, subject, email, repo.name.clone()));
                        }
                    }
                    Err(e) => tracing::warn!(repo=%repo.name, error=%e, "get_commits_between failed"),
                }
            }
        }
        ChangelogRange::Dates { since, until } => {
            for repo in input.repos {
                // Use the configured release branch, falling back to the group default.
                let branch = repo
                    .release_branch
                    .as_deref()
                    .unwrap_or(input.default_release_branch);
                match rm_git_ops::get_commits_since_until(
                    PathBuf::from(&repo.path),
                    branch,
                    since,
                    until.as_deref(),
                )
                .await
                {
                    Ok(commits) => {
                        for (sha, subject, email) in commits {
                            all_raw.push((sha, subject, email, repo.name.clone()));
                        }
                    }
                    Err(e) => tracing::warn!(repo=%repo.name, error=%e, "get_commits_since_until failed"),
                }
            }
        }
    }

    let total_analyzed = all_raw.len();
    let mut seen_tickets: HashSet<String> = HashSet::new();
    let mut entries: Vec<CommitEntry> = Vec::new();

    for (sha, subject, email, repo_name) in all_raw {
        // --- filtering ---
        if SKIP_SET.is_match(&subject) || BOILERPLATE_SET.is_match(&subject) {
            continue;
        }
        // Must contain a Jira ticket ID (unless no-ticket commits are wanted — TUI required it).
        let ticket_key = JIRA_TICKET.find(&subject).map(|m| m.as_str().to_string());
        if ticket_key.is_none() {
            continue;
        }
        let ticket_key = ticket_key.unwrap();

        // Deduplicate by ticket key (first occurrence wins).
        if !seen_tickets.insert(ticket_key.clone()) {
            continue;
        }

        // --- parse conventional commit prefix ---
        let (commit_type, breaking, clean_subject) =
            if let Some(caps) = CC_PREFIX.captures(&subject) {
                let ty = cc_type_label(caps.get(1).map_or("", |m| m.as_str()));
                let breaking = caps.get(3).is_some();
                let desc = caps.get(4).map_or(subject.as_str(), |m| m.as_str());
                (ty, breaking, desc.to_string())
            } else {
                ("Other", false, subject.clone())
            };

        let section_title = if breaking {
            "Breaking Changes"
        } else {
            commit_type
        };

        entries.push(CommitEntry {
            sha,
            subject: clean_subject,
            author_email: email,
            repo_name,
            ticket_key: Some(ticket_key),
            commit_type: section_title.to_string(),
            breaking,
        });
    }

    let total_included = entries.len();

    // --- group by section ---
    let mut section_map: HashMap<&'static str, Vec<CommitEntry>> = HashMap::new();
    for entry in entries {
        // Find the canonical static key for the section title.
        let key = SECTION_ORDER
            .iter()
            .find(|&&s| s == entry.commit_type.as_str())
            .copied()
            .unwrap_or("Other");
        section_map.entry(key).or_default().push(entry);
    }

    // Sort entries within each section by ticket key numerically.
    for entries in section_map.values_mut() {
        entries.sort_by(|a, b| {
            let num = |e: &CommitEntry| -> Option<u64> {
                e.ticket_key
                    .as_ref()
                    .and_then(|k| k.split('-').nth(1))
                    .and_then(|n| n.parse().ok())
            };
            match (num(a), num(b)) {
                (Some(a), Some(b)) => a.cmp(&b),
                _ => a.ticket_key.cmp(&b.ticket_key),
            }
        });
    }

    // Build ordered Vec<ChangelogSection>.
    let sections: Vec<ChangelogSection> = SECTION_ORDER
        .iter()
        .filter_map(|&title| {
            section_map.remove(title).map(|entries| ChangelogSection {
                title: title.to_string(),
                entries,
            })
        })
        .collect();

    // --- stats ---
    let mut by_type: HashMap<String, usize> = HashMap::new();
    let mut by_repo: HashMap<String, usize> = HashMap::new();
    for section in &sections {
        *by_type.entry(section.title.clone()).or_default() += section.entries.len();
        for e in &section.entries {
            *by_repo.entry(e.repo_name.clone()).or_default() += 1;
        }
    }
    let mut by_type: Vec<(String, usize)> = by_type.into_iter().collect();
    by_type.sort_by(|a, b| b.1.cmp(&a.1));
    let mut by_repo: Vec<(String, usize)> = by_repo.into_iter().collect();
    by_repo.sort_by(|a, b| b.1.cmp(&a.1));

    let stats = ChangelogStats {
        total_analyzed,
        total_included,
        by_type: by_type.clone(),
        by_repo: by_repo.clone(),
    };

    // --- render markdown ---
    let markdown = render_markdown(input.version, &sections, &stats, input.jira_url);

    ChangelogResult {
        version: input.version.to_string(),
        sections,
        stats,
        markdown,
    }
}

fn render_markdown(
    version: &str,
    sections: &[ChangelogSection],
    stats: &ChangelogStats,
    jira_url: Option<&str>,
) -> String {
    let mut out = String::with_capacity(4096);

    if version.is_empty() {
        out.push_str("# Changelog\n\n");
    } else {
        out.push_str(&format!("# Release {version} Changelog\n\n"));
    }

    for section in sections {
        if section.entries.is_empty() {
            continue;
        }
        out.push_str(&format!("## {}\n", section.title));
        for e in &section.entries {
            let ticket_ref = match (&e.ticket_key, jira_url) {
                (Some(key), Some(base)) => {
                    let base = base.trim_end_matches('/');
                    format!("[{key}]({base}/browse/{key})")
                }
                (Some(key), None) => key.clone(),
                (None, _) => String::new(),
            };
            if ticket_ref.is_empty() {
                out.push_str(&format!("- {} ({})\n", e.subject, e.repo_name));
            } else {
                out.push_str(&format!(
                    "- {} — {} ({})\n",
                    ticket_ref, e.subject, e.repo_name
                ));
            }
        }
        out.push('\n');
    }

    out.push_str("---\n\n## Statistics\n");
    out.push_str(&format!(
        "**Total commits analyzed:** {}  \n**Commits included:** {}\n\n",
        stats.total_analyzed, stats.total_included
    ));
    if !stats.by_type.is_empty() {
        out.push_str("**By Category:**\n");
        for (t, n) in &stats.by_type {
            out.push_str(&format!("- {t}: {n}\n"));
        }
        out.push('\n');
    }
    if !stats.by_repo.is_empty() {
        out.push_str("**By Repository:**\n");
        for (r, n) in &stats.by_repo {
            out.push_str(&format!("- {r}: {n}\n"));
        }
    }
    out
}

/// Collect the union of all tags from all repos, sorted newest-first.
pub async fn collect_group_tags(repos: &[Repository]) -> Vec<TagInfo> {
    let mut handles = Vec::with_capacity(repos.len());
    for repo in repos {
        let path = PathBuf::from(&repo.path);
        handles.push(tokio::spawn(async move {
            rm_git_ops::list_tags_for_repo(path).await.unwrap_or_default()
        }));
    }
    // Merge by name, keeping the earliest date seen (stable sort).
    let mut tag_map: HashMap<String, Option<i64>> = HashMap::new();
    for handle in futures::future::join_all(handles).await {
        if let Ok(tags) = handle {
            for t in tags {
                tag_map.entry(t.name).or_insert(t.date);
            }
        }
    }
    let mut out: Vec<TagInfo> = tag_map
        .into_iter()
        .map(|(name, date)| TagInfo { name, date })
        .collect();
    // Sort newest-first: None (no date) goes to end.
    out.sort_by(|a, b| match (a.date, b.date) {
        (Some(a), Some(b)) => b.cmp(&a),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.name.cmp(&b.name),
    });
    out
}
