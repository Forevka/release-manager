//! Jira REST client (Jira Cloud v3).
//!
//! Implements only what the release-manager needs:
//! - List versions for a project (so the user can pick a fixVersion).
//! - List all issues in a given fixVersion (paginated via `/search/jql`).

use std::time::Duration;

use rm_core::{JiraIssue, JiraVersion};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum JiraError {
    #[error("invalid base URL: {0}")]
    InvalidUrl(String),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("url join: {0}")]
    UrlJoin(#[from] url::ParseError),
    #[error("jira responded {status}: {body}")]
    Status { status: u16, body: String },
    #[error("missing credentials: {0}")]
    MissingCredentials(&'static str),
}

#[derive(Debug, Clone)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct JiraClient {
    http: reqwest::Client,
    base: Url,
    email: String,
    token: String,
}

impl JiraClient {
    pub fn new(cfg: JiraConfig) -> Result<Self, JiraError> {
        if cfg.email.is_empty() || cfg.token.is_empty() || cfg.base_url.is_empty() {
            return Err(JiraError::MissingCredentials(
                "set Jira URL, email and token in Settings → Connections first",
            ));
        }
        let trimmed = cfg.base_url.trim_end_matches('/');
        let base = Url::parse(&format!("{trimmed}/"))
            .map_err(|_| JiraError::InvalidUrl(cfg.base_url.clone()))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base,
            email: cfg.email,
            token: cfg.token,
        })
    }

    fn url(&self, path: &str) -> Result<Url, JiraError> {
        Ok(self.base.join(path.trim_start_matches('/'))?)
    }

    /// Returns all versions for a project (released and unreleased), sorted
    /// newest-first by numeric ID. Jira version IDs are monotonically
    /// assigned at creation time, so this matches "newest fixVersion first"
    /// which is what release managers expect to see at the top of the list.
    pub async fn list_versions(&self, project_key: &str) -> Result<Vec<JiraVersion>, JiraError> {
        let url = self.url(&format!("rest/api/3/project/{project_key}/versions"))?;
        let resp = self
            .http
            .get(url)
            .basic_auth(&self.email, Some(&self.token))
            .header("Accept", "application/json")
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(JiraError::Status {
                status: status.as_u16(),
                body,
            });
        }
        let raw: Vec<RawVersion> = resp.json().await?;
        // Parse IDs to integers up-front so the sort key has a real ordering.
        // Jira's REST contract guarantees `id` is a numeric string; bail loud
        // if that ever stops being true.
        let mut out: Vec<(u64, JiraVersion)> = raw
            .into_iter()
            .map(|v| {
                let id_num = v.id.parse::<u64>().map_err(|_| JiraError::Status {
                    status: 500,
                    body: format!("Jira returned non-numeric version id: {}", v.id),
                })?;
                Ok::<_, JiraError>((id_num, v.into()))
            })
            .collect::<Result<_, _>>()?;
        out.sort_by_key(|(id, _)| std::cmp::Reverse(*id));
        Ok(out.into_iter().map(|(_, v)| v).collect())
    }

    /// Lists every issue with `fixVersion = "<version_name>"` for the given
    /// project, following pagination (`nextPageToken`) until exhausted.
    pub async fn list_issues_in_version(
        &self,
        project_key: &str,
        version_name: &str,
    ) -> Result<Vec<JiraIssue>, JiraError> {
        let jql = format!(
            "project = \"{}\" AND fixVersion = \"{}\"",
            project_key.replace('"', "\\\""),
            version_name.replace('"', "\\\"")
        );

        let endpoint = self.url("rest/api/3/search/jql")?;
        let mut next_token: Option<String> = None;
        let mut out = Vec::new();

        loop {
            let body = SearchRequest {
                jql: &jql,
                fields: &["summary", "status", "assignee"],
                max_results: 100,
                next_page_token: next_token.as_deref(),
            };
            let resp = self
                .http
                .post(endpoint.clone())
                .basic_auth(&self.email, Some(&self.token))
                .header("Accept", "application/json")
                .json(&body)
                .send()
                .await?;
            let status = resp.status();
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(JiraError::Status {
                    status: status.as_u16(),
                    body,
                });
            }
            let page: SearchResponse = resp.json().await?;
            out.extend(page.issues.into_iter().map(Into::into));
            match page.next_page_token {
                Some(t) if !t.is_empty() => next_token = Some(t),
                _ => break,
            }
        }
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Wire types — kept private; convert into rm-core types before exposing.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RawVersion {
    id: String,
    name: String,
    #[serde(default)]
    released: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "releaseDate")]
    release_date: Option<String>,
}

impl From<RawVersion> for JiraVersion {
    fn from(v: RawVersion) -> Self {
        JiraVersion {
            id: v.id,
            name: v.name,
            released: v.released,
            archived: v.archived,
            description: v.description,
            release_date: v.release_date,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest<'a> {
    jql: &'a str,
    fields: &'a [&'a str],
    max_results: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_page_token: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    issues: Vec<RawIssue>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawIssue {
    key: String,
    #[serde(default)]
    fields: RawIssueFields,
}

#[derive(Debug, Default, Deserialize)]
struct RawIssueFields {
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    status: Option<RawStatus>,
    #[serde(default)]
    assignee: Option<RawAssignee>,
}

#[derive(Debug, Deserialize)]
struct RawStatus {
    name: String,
}

#[derive(Debug, Deserialize)]
struct RawAssignee {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

impl From<RawIssue> for JiraIssue {
    fn from(i: RawIssue) -> Self {
        JiraIssue {
            key: i.key,
            summary: i.fields.summary.unwrap_or_default(),
            status: i.fields.status.map(|s| s.name).unwrap_or_default(),
            assignee: i.fields.assignee.and_then(|a| a.display_name),
        }
    }
}
