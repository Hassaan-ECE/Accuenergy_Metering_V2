use std::{env, fs, path::PathBuf};

use serde::Serialize;
use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub root: PathBuf,
    pub settings: PathBuf,
    pub database: PathBuf,
    pub reports: PathBuf,
    pub exports: PathBuf,
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
        let paths = Self {
            settings: root.join("settings.json"),
            database: root.join("meter_log.db"),
            reports: root.join("reports"),
            exports: root.join("exports"),
            root,
        };
        fs::create_dir_all(&paths.reports)
            .map_err(|error| format!("Could not create reports directory: {error}"))?;
        fs::create_dir_all(&paths.exports)
            .map_err(|error| format!("Could not create exports directory: {error}"))?;
        Ok(paths)
    }
}
