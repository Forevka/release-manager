//! Tauri event protocol for the activity bar.
//!
//! Long-running commands receive an optional `task_id` from the frontend.
//! When set, the command emits `task-event` payloads tagged with that ID
//! so the activity-bar store can render live progress and a per-task log.
//!
//! The task lifecycle (start / finished / error) is owned by the frontend
//! mutation; the backend only sends incremental progress and log entries.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const TASK_EVENT: &str = "task-event";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskLogLevel {
    Info,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "tag", rename_all = "kebab-case")]
pub enum TaskEventKind {
    Progress { done: u32, total: u32 },
    Log { level: TaskLogLevel, message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub task_id: String,
    pub kind: TaskEventKind,
}

pub fn emit_progress(app: &AppHandle, task_id: &str, done: u32, total: u32) {
    let _ = app.emit(
        TASK_EVENT,
        TaskEvent {
            task_id: task_id.to_string(),
            kind: TaskEventKind::Progress { done, total },
        },
    );
}

pub fn emit_log(app: &AppHandle, task_id: &str, level: TaskLogLevel, message: String) {
    let _ = app.emit(
        TASK_EVENT,
        TaskEvent {
            task_id: task_id.to_string(),
            kind: TaskEventKind::Log { level, message },
        },
    );
}
