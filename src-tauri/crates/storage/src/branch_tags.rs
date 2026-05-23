//! CRUD for [`BranchTag`] — user-applied markers (broken/not-needed/obsolete/wip)
//! that exclude a (repo, branch) from bulk merges.

use chrono::{DateTime, Utc};
use rm_core::{BranchTag, BranchTagKind};
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

fn kind_to_str(kind: &BranchTagKind) -> &'static str {
    match kind {
        BranchTagKind::Broken => "broken",
        BranchTagKind::NotNeeded => "not-needed",
        BranchTagKind::Obsolete => "obsolete",
        BranchTagKind::Wip => "wip",
    }
}

fn kind_from_str(s: &str) -> Option<BranchTagKind> {
    match s {
        "broken" => Some(BranchTagKind::Broken),
        "not-needed" => Some(BranchTagKind::NotNeeded),
        "obsolete" => Some(BranchTagKind::Obsolete),
        "wip" => Some(BranchTagKind::Wip),
        _ => None,
    }
}

fn row_to_tag(row: &sqlx::sqlite::SqliteRow) -> Result<BranchTag, StorageError> {
    let repo_id_str: String = row.get("repo_id");
    let repo_id =
        Uuid::parse_str(&repo_id_str).map_err(|e| StorageError::Conflict(e.to_string()))?;
    let kind_str: String = row.get("kind");
    let kind = kind_from_str(&kind_str)
        .ok_or_else(|| StorageError::Conflict(format!("unknown branch tag kind: {kind_str}")))?;
    let updated_at: String = row.get("updated_at");

    Ok(BranchTag {
        repo_id,
        branch_name: row.get("branch_name"),
        kind,
        note: row.get("note"),
        updated_at: parse_dt(&updated_at),
    })
}

pub async fn upsert(
    db: &Database,
    repo_id: Uuid,
    branch_name: &str,
    kind: &BranchTagKind,
    note: Option<&str>,
) -> Result<BranchTag, StorageError> {
    sqlx::query(
        "INSERT INTO branch_tag (repo_id, branch_name, kind, note, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(repo_id, branch_name) DO UPDATE SET
             kind = excluded.kind,
             note = excluded.note,
             updated_at = excluded.updated_at",
    )
    .bind(repo_id.to_string())
    .bind(branch_name)
    .bind(kind_to_str(kind))
    .bind(note)
    .execute(db.pool())
    .await?;

    get(db, repo_id, branch_name)
        .await?
        .ok_or(StorageError::NotFound)
}

pub async fn clear(
    db: &Database,
    repo_id: Uuid,
    branch_name: &str,
) -> Result<(), StorageError> {
    sqlx::query("DELETE FROM branch_tag WHERE repo_id = ?1 AND branch_name = ?2")
        .bind(repo_id.to_string())
        .bind(branch_name)
        .execute(db.pool())
        .await?;
    Ok(())
}

pub async fn get(
    db: &Database,
    repo_id: Uuid,
    branch_name: &str,
) -> Result<Option<BranchTag>, StorageError> {
    let row = sqlx::query(
        "SELECT repo_id, branch_name, kind, note, updated_at
         FROM branch_tag
         WHERE repo_id = ?1 AND branch_name = ?2",
    )
    .bind(repo_id.to_string())
    .bind(branch_name)
    .fetch_optional(db.pool())
    .await?;
    row.as_ref().map(row_to_tag).transpose()
}

pub async fn list_for_repo(
    db: &Database,
    repo_id: Uuid,
) -> Result<Vec<BranchTag>, StorageError> {
    let rows = sqlx::query(
        "SELECT repo_id, branch_name, kind, note, updated_at
         FROM branch_tag
         WHERE repo_id = ?1
         ORDER BY updated_at DESC",
    )
    .bind(repo_id.to_string())
    .fetch_all(db.pool())
    .await?;
    rows.iter().map(row_to_tag).collect()
}
