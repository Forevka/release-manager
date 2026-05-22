use rm_core::CoreInfo;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub app_name: &'static str,
    pub app_version: &'static str,
    pub core: CoreInfo,
}

/// End-to-end wiring sanity check.
#[tauri::command]
pub fn ping() -> Health {
    Health {
        app_name: env!("CARGO_PKG_NAME"),
        app_version: env!("CARGO_PKG_VERSION"),
        core: CoreInfo::current(),
    }
}
