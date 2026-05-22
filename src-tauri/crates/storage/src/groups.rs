//! CRUD for [`ProjectGroup`].

use chrono::{DateTime, Utc};
use rm_core::{NewProjectGroup, ProjectGroup};
use sqlx::Row;
use uuid::Uuid;

use crate::{Database, StorageError};

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| {
            // SQLite's `datetime('now')` returns "YYYY-MM-DD HH:MM:SS" (no T, no Z).
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|n| n.and_utc())
                .unwrap_or_else(|_| Utc::now())
        })
}

fn row_to_group(row: &sqlx::sqlite::SqliteRow) -> Result<ProjectGroup, StorageError> {
    let id_str: String = row.get("id");
    let id = Uuid::parse_str(&id_str).map_err(|e| StorageError::Conflict(e.to_string()))?;
    let created_at: String = row.get("created_at");
    let updated_at: String = row.get("updated_at");

    Ok(ProjectGroup {
        id,
        name: row.get("name"),
        jira_project_key: row.get("jira_project_key"),
        default_release_branch: row.get("default_release_branch"),
        default_prod_branch: row.get("default_prod_branch"),
        git_timeout_seconds: row.get("git_timeout_seconds"),
        max_retries: row.get("max_retries"),
        sort_order: row.get("sort_order"),
        created_at: parse_dt(&created_at),
        updated_at: parse_dt(&updated_at),
    })
}

pub async fn list(db: &Database) -> Result<Vec<ProjectGroup>, StorageError> {
    let rows = sqlx::query(
        "SELECT id, name, jira_project_key, default_release_branch, default_prod_branch,
                git_timeout_seconds, max_retries, sort_order, created_at, updated_at
         FROM project_group
         ORDER BY sort_order ASC, name ASC",
    )
    .fetch_all(db.pool())
    .await?;
    rows.iter().map(row_to_group).collect()
}

pub async fn get(db: &Database, id: Uuid) -> Result<ProjectGroup, StorageError> {
    let row = sqlx::query(
        "SELECT id, name, jira_project_key, default_release_branch, default_prod_branch,
                git_timeout_seconds, max_retries, sort_order, created_at, updated_at
         FROM project_group WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(db.pool())
    .await?;
    let row = row.ok_or(StorageError::NotFound)?;
    row_to_group(&row)
}

pub async fn create(db: &Database, input: NewProjectGroup) -> Result<ProjectGroup, StorageError> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO project_group
             (id, name, jira_project_key, default_release_branch, default_prod_branch,
              git_timeout_seconds, max_retries)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(id.to_string())
    .bind(&input.name)
    .bind(&input.jira_project_key)
    .bind(&input.default_release_branch)
    .bind(&input.default_prod_branch)
    .bind(input.git_timeout_seconds)
    .bind(input.max_retries)
    .execute(db.pool())
    .await
    .map_err(map_unique_err)?;
    get(db, id).await
}

pub async fn update(
    db: &Database,
    id: Uuid,
    input: NewProjectGroup,
) -> Result<ProjectGroup, StorageError> {
    let result = sqlx::query(
        "UPDATE project_group SET
             name = ?2,
             jira_project_key = ?3,
             default_release_branch = ?4,
             default_prod_branch = ?5,
             git_timeout_seconds = ?6,
             max_retries = ?7,
             updated_at = datetime('now')
         WHERE id = ?1",
    )
    .bind(id.to_string())
    .bind(&input.name)
    .bind(&input.jira_project_key)
    .bind(&input.default_release_branch)
    .bind(&input.default_prod_branch)
    .bind(input.git_timeout_seconds)
    .bind(input.max_retries)
    .execute(db.pool())
    .await
    .map_err(map_unique_err)?;

    if result.rows_affected() == 0 {
        return Err(StorageError::NotFound);
    }
    get(db, id).await
}

pub async fn delete(db: &Database, id: Uuid) -> Result<(), StorageError> {
    let result = sqlx::query("DELETE FROM project_group WHERE id = ?1")
        .bind(id.to_string())
        .execute(db.pool())
        .await?;
    if result.rows_affected() == 0 {
        return Err(StorageError::NotFound);
    }
    Ok(())
}

fn map_unique_err(e: sqlx::Error) -> StorageError {
    let msg = e.to_string();
    if msg.contains("UNIQUE constraint failed") {
        StorageError::Conflict("a group with that name already exists".into())
    } else {
        StorageError::Sql(e)
    }
}
