-- Application settings (non-secret key/value config like jira_url, gitlab_url).
CREATE TABLE setting (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A project group bundles N repositories that release together.
CREATE TABLE project_group (
    id                       TEXT PRIMARY KEY NOT NULL,
    name                     TEXT NOT NULL UNIQUE,
    jira_project_key         TEXT,
    default_release_branch   TEXT NOT NULL DEFAULT 'UAT',
    default_prod_branch      TEXT NOT NULL DEFAULT 'main',
    git_timeout_seconds      INTEGER NOT NULL DEFAULT 60,
    max_retries              INTEGER NOT NULL DEFAULT 3,
    sort_order               INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A repository = one local git clone, owned by exactly one group.
CREATE TABLE repository (
    id              TEXT PRIMARY KEY NOT NULL,
    group_id        TEXT NOT NULL REFERENCES project_group(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    path            TEXT NOT NULL,
    release_branch  TEXT,                          -- NULL = inherit from group
    prod_branch     TEXT,                          -- NULL = inherit from group
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, name)
);

CREATE INDEX idx_repository_group_id ON repository(group_id);

-- User-flagged branches: skip from auto-merge ('broken', 'not-needed',
-- 'obsolete', 'wip'). The CHECK keeps storage honest with the enum in rm-core.
CREATE TABLE branch_tag (
    repo_id     TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('broken', 'not-needed', 'obsolete', 'wip')),
    note        TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repo_id, branch_name)
);

-- Audit trail of mutating actions (merge, fetch, checkout, ...).
CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
    actor           TEXT,
    action          TEXT NOT NULL,
    target_repo_id  TEXT REFERENCES repository(id) ON DELETE SET NULL,
    target_branch   TEXT,
    outcome         TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'skipped')),
    details         TEXT   -- JSON
);

CREATE INDEX idx_audit_log_occurred_at ON audit_log(occurred_at DESC);
