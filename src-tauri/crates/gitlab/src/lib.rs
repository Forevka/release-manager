//! GitLab REST client (v4).
//!
//! Phase 9 scope: list every project under a given group, paginated. Auth
//! is via the user's Personal Access Token from the keychain (passed in via
//! [`GitLabConfig`]).

use std::time::Duration;

use rm_core::GitLabProject;
use serde::Deserialize;
use thiserror::Error;
use url::Url;

const PAGE_SIZE: u32 = 100;
const MAX_PAGES: u32 = 50;

#[derive(Debug, Error)]
pub enum GitLabError {
    #[error("invalid GitLab URL: {0}")]
    InvalidUrl(String),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("url: {0}")]
    UrlJoin(#[from] url::ParseError),
    #[error("gitlab responded {status}: {body}")]
    Status { status: u16, body: String },
    #[error("missing credentials: {0}")]
    MissingCredentials(&'static str),
}

#[derive(Debug, Clone)]
pub struct GitLabConfig {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct GitLabClient {
    http: reqwest::Client,
    base: Url,
    token: String,
}

impl GitLabClient {
    pub fn new(cfg: GitLabConfig) -> Result<Self, GitLabError> {
        if cfg.token.is_empty() || cfg.base_url.is_empty() {
            return Err(GitLabError::MissingCredentials(
                "set GitLab URL and token in Settings → Connections first",
            ));
        }
        let trimmed = cfg.base_url.trim_end_matches('/');
        let base = Url::parse(&format!("{trimmed}/"))
            .map_err(|_| GitLabError::InvalidUrl(cfg.base_url.clone()))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(45))
            .build()?;
        Ok(Self {
            http,
            base,
            token: cfg.token,
        })
    }

    /// List every project in `group_path` (and descendants if
    /// `include_subgroups` is true), excluding archived projects.
    pub async fn list_group_projects(
        &self,
        group_path: &str,
        include_subgroups: bool,
    ) -> Result<Vec<GitLabProject>, GitLabError> {
        // GitLab's API takes either a numeric ID or the URL-encoded
        // path-style ID (e.g. "devcom%2Fsubgroup"). For typical group paths
        // we only need to encode the slashes.
        let encoded_id = group_path.replace('/', "%2F");
        let mut out = Vec::new();
        let mut page: u32 = 1;

        loop {
            let path = format!(
                "api/v4/groups/{encoded_id}/projects\
                 ?per_page={PAGE_SIZE}\
                 &page={page}\
                 &include_subgroups={include_subgroups}\
                 &archived=false\
                 &order_by=path\
                 &sort=asc"
            );
            let url = self.base.join(&path)?;
            let resp = self
                .http
                .get(url)
                .header("PRIVATE-TOKEN", &self.token)
                .header("Accept", "application/json")
                .send()
                .await?;
            let status = resp.status();
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(GitLabError::Status {
                    status: status.as_u16(),
                    body,
                });
            }
            let raw: Vec<RawProject> = resp.json().await?;
            let len = raw.len();
            out.extend(raw.into_iter().map(Into::into));
            if (len as u32) < PAGE_SIZE {
                break;
            }
            page += 1;
            if page > MAX_PAGES {
                break;
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Deserialize)]
struct RawProject {
    id: i64,
    name: String,
    path: String,
    #[serde(rename = "path_with_namespace")]
    path_with_namespace: String,
    #[serde(default)]
    default_branch: Option<String>,
    #[serde(default)]
    ssh_url_to_repo: String,
    #[serde(default)]
    http_url_to_repo: String,
    #[serde(default)]
    web_url: String,
    #[serde(default)]
    archived: bool,
}

impl From<RawProject> for GitLabProject {
    fn from(p: RawProject) -> Self {
        GitLabProject {
            id: p.id,
            name: p.name,
            path: p.path,
            path_with_namespace: p.path_with_namespace,
            default_branch: p.default_branch,
            ssh_url_to_repo: p.ssh_url_to_repo,
            http_url_to_repo: p.http_url_to_repo,
            web_url: p.web_url,
            archived: p.archived,
        }
    }
}
