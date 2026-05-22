//! CRUD for [`Repository`] entries (each owned by exactly one project group).

use chrono::{DateTime, Utc};
use rm_core::{NewRepository, Repository};
use sqlx::Row;
use uuid::Uuid;

use crate::{Database, StorageError};

fn parse_dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|n| n.and_utc())
                .unwrap_or_else(|_| Utc::now())
        })
}

fn row_to_repo(row: &sqlx::sqlite::SqliteRow) -> Result<Repository, StorageError> {
    let id_str: String = row.get("id");
    let group_id_str: String = row.get("group_id");
    let id = Uuid::parse_str(&id_str).map_err(|e| StorageError::Conflict(e.to_string()))?;
    let group_id = Uuid::parse_str(&group_id_str).map_err(|e| StorageError::Conflict(e.to_string()))?;
    let created_at: String = row.get("created_at");
    let updated_at: String = row.get("updated_at");

    Ok(Repository {
        id,
        group_id,
        name: row.get("name"),
        path: row.get("path"),
        release_branch: row.get("release_branch"),
        prod_branch: row.get("prod_branch"),
        sort_order: row.get("sort_order"),
        created_at: parse_dt(&created_at),
        updated_at: parse_dt(&updated_at),
    })
}

pub async fn list_for_group(db: &Database, group_id: Uuid) -> Result<Vec<Repository>, StorageError> {
    let rows = sqlx::query(
        "SELECT id, group_id, name, path, release_branch, prod_branch,
                sort_order, created_at, updated_at
         FROM repository
         WHERE group_id = ?1
         ORDER BY sort_order ASC, name ASC",
    )
    .bind(group_id.to_string())
    .fetch_all(db.pool())
    .await?;
    rows.iter().map(row_to_repo).collect()
}

pub async fn get(db: &Database, id: Uuid) -> Result<Repository, StorageError> {
    let row = sqlx::query(
        "SELECT id, group_id, name, path, release_branch, prod_branch,
                sort_order, created_at, updated_at
         FROM repository WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(db.pool())
    .await?;
    let row = row.ok_or(StorageError::NotFound)?;
    row_to_repo(&row)
}

pub async fn create(db: &Database, input: NewRepository) -> Result<Repository, StorageError> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO repository
             (id, group_id, name, path, release_branch, prod_branch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(id.to_string())
    .bind(input.group_id.to_string())
    .bind(&input.name)
    .bind(&input.path)
    .bind(&input.release_branch)
    .bind(&input.prod_branch)
    .execute(db.pool())
    .await
    .map_err(map_unique_err)?;
    get(db, id).await
}

pub async fn update(
    db: &Database,
    id: Uuid,
    input: NewRepository,
) -> Result<Repository, StorageError> {
    let result = sqlx::query(
        "UPDATE repository SET
             group_id = ?2,
             name = ?3,
             path = ?4,
             release_branch = ?5,
             prod_branch = ?6,
             updated_at = datetime('now')
         WHERE id = ?1",
    )
    .bind(id.to_string())
    .bind(input.group_id.to_string())
    .bind(&input.name)
    .bind(&input.path)
    .bind(&input.release_branch)
    .bind(&input.prod_branch)
    .execute(db.pool())
    .await
    .map_err(map_unique_err)?;

    if result.rows_affected() == 0 {
        return Err(StorageError::NotFound);
    }
    get(db, id).await
}

pub async fn delete(db: &Database, id: Uuid) -> Result<(), StorageError> {
    let result = sqlx::query("DELETE FROM repository WHERE id = ?1")
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
        StorageError::Conflict("a repository with that name already exists in the group".into())
    } else {
        StorageError::Sql(e)
    }
}
