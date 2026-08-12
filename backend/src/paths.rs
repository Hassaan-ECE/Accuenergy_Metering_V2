use std::{
    env, fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::Local;
use serde::Serialize;
use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Manager;

const APP_LOG_LIMIT_BYTES: u64 = 5 * 1024 * 1024;
static APP_LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub root: PathBuf,
    pub settings: PathBuf,
    pub database: PathBuf,
    pub reports: PathBuf,
    pub exports: PathBuf,
    pub logs: PathBuf,
    pub log_file: PathBuf,
}

impl AppPaths {
    pub fn resolve(_app: &AppHandle) -> Result<Self, String> {
        #[cfg(windows)]
        let root = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "LOCALAPPDATA is not available.".to_string())?
            .join("com.accuenergy.metering");

        #[cfg(not(windows))]
        let root = _app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

        Self::from_root(root)
    }

    pub fn from_root(root: PathBuf) -> Result<Self, String> {
        let logs = root.join("logs");
        let paths = Self {
            settings: root.join("settings.json"),
            database: root.join("meter_log.db"),
            reports: root.join("reports"),
            exports: root.join("exports"),
            log_file: logs.join("app.log"),
            logs,
            root,
        };
        fs::create_dir_all(&paths.reports)
            .map_err(|error| format!("Could not create reports directory: {error}"))?;
        fs::create_dir_all(&paths.exports)
            .map_err(|error| format!("Could not create exports directory: {error}"))?;
        let _ = fs::create_dir_all(&paths.logs);
        Ok(paths)
    }
}

pub(crate) fn append_app_log(path: &Path, message: &str) -> Result<(), String> {
    append_app_log_with_limit(path, message, APP_LOG_LIMIT_BYTES)
}

fn append_app_log_with_limit(path: &Path, message: &str, limit_bytes: u64) -> Result<(), String> {
    let _guard = APP_LOG_LOCK
        .lock()
        .map_err(|_| "Application log lock is unavailable.".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create application log directory: {error}"))?;
    }
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > limit_bytes)
    {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Application log path must end with a valid file name.".to_string())?;
        let rotated_path = path.with_file_name(format!("{file_name}.1"));
        if rotated_path.exists() {
            fs::remove_file(&rotated_path)
                .map_err(|error| format!("Could not replace rotated application log: {error}"))?;
        }
        fs::rename(path, &rotated_path)
            .map_err(|error| format!("Could not rotate application log: {error}"))?;
    }

    let message = message.lines().collect::<Vec<_>>().join(" | ");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Could not open application log: {error}"))?;
    writeln!(
        file,
        "{}  {}",
        Local::now().format("%Y-%m-%d %H:%M:%S"),
        message
    )
    .map_err(|error| format!("Could not append application log: {error}"))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::append_app_log_with_limit;

    #[test]
    fn app_log_appends_lines_in_order() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("logs").join("app.log");

        append_app_log_with_limit(&path, "first event", 1024).unwrap();
        append_app_log_with_limit(&path, "second event", 1024).unwrap();

        let content = std::fs::read_to_string(path).unwrap();
        let lines = content.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("first event"));
        assert!(lines[1].ends_with("second event"));
    }

    #[test]
    fn app_log_rotates_before_the_next_append() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("logs").join("app.log");

        append_app_log_with_limit(&path, &"x".repeat(80), 64).unwrap();
        append_app_log_with_limit(&path, "after rotation", 64).unwrap();

        let rotated = std::fs::read_to_string(path.with_file_name("app.log.1")).unwrap();
        let current = std::fs::read_to_string(path).unwrap();
        assert!(rotated.contains(&"x".repeat(80)));
        assert!(current.ends_with("after rotation\n"));
    }
}
