use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    domain::config::AppConfig,
    meter_io::MeterSnapshot,
    monitor::{MonitorManager, MonitorState, StartMonitorResult},
    paths::AppPaths,
    report,
    review::{self, ReviewDataset},
    storage::{self, SessionRecord},
};

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let paths = AppPaths::resolve(&app)?;
    match AppConfig::load(&paths.settings) {
        Ok(config) => Ok(config),
        Err(_) => Ok(AppConfig::default()),
    }
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let paths = AppPaths::resolve(&app)?;
    config.save(&paths.settings)
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<PortInfo>, String> {
    let mut ports = serialport::available_ports()
        .map_err(|error| format!("Could not enumerate serial ports: {error}"))?
        .into_iter()
        .map(|port| PortInfo {
            name: port.port_name,
            description: port_description(&port.port_type),
        })
        .collect::<Vec<_>>();
    ports.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(ports)
}

#[tauri::command]
pub fn get_app_paths(app: AppHandle) -> Result<AppPaths, String> {
    AppPaths::resolve(&app)
}

#[tauri::command]
pub async fn test_rs485(app: AppHandle) -> Result<MeterSnapshot, String> {
    let paths = AppPaths::resolve(&app)?;
    let config = AppConfig::load(&paths.settings)
        .unwrap_or_default()
        .normalized()?;
    tauri::async_runtime::spawn_blocking(move || crate::meter_io::probe(&config))
        .await
        .map_err(|error| format!("RS485 test task failed: {error}"))
}

#[tauri::command]
pub fn start_monitor(
    app: AppHandle,
    manager: State<'_, MonitorManager>,
) -> Result<StartMonitorResult, String> {
    let paths = AppPaths::resolve(&app)?;
    let config = AppConfig::load(&paths.settings)
        .unwrap_or_default()
        .normalized()?;
    manager.start(app, paths, config)
}

#[tauri::command]
pub fn stop_monitor(manager: State<'_, MonitorManager>) -> Result<Option<String>, String> {
    manager.stop()
}

#[tauri::command]
pub fn get_monitor_state(manager: State<'_, MonitorManager>) -> Result<MonitorState, String> {
    manager.state()
}

#[tauri::command]
pub async fn generate_report(app: AppHandle, session_id: String) -> Result<String, String> {
    let paths = AppPaths::resolve(&app)?;
    tauri::async_runtime::spawn_blocking(move || report::generate(&paths, &session_id))
        .await
        .map_err(|error| format!("Report task failed: {error}"))?
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_sessions(app: AppHandle) -> Result<Vec<SessionRecord>, String> {
    let paths = AppPaths::resolve(&app)?;
    storage::list_sessions(&paths.database, 100)
}

#[tauri::command]
pub fn get_latest_session(app: AppHandle) -> Result<Option<SessionRecord>, String> {
    let paths = AppPaths::resolve(&app)?;
    storage::get_latest_session(&paths.database)
}

#[tauri::command]
pub async fn load_session_review(
    app: AppHandle,
    session_id: String,
) -> Result<ReviewDataset, String> {
    let paths = AppPaths::resolve(&app)?;
    tauri::async_runtime::spawn_blocking(move || review::load_session(&paths, &session_id))
        .await
        .map_err(|error| format!("Session review task failed: {error}"))?
}

#[tauri::command]
pub async fn load_csv_review(path: String) -> Result<ReviewDataset, String> {
    let path = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || review::load_csv(&path))
        .await
        .map_err(|error| format!("CSV review task failed: {error}"))?
}

#[tauri::command]
pub async fn export_session_csv(app: AppHandle, session_id: String) -> Result<String, String> {
    let paths = AppPaths::resolve(&app)?;
    tauri::async_runtime::spawn_blocking(move || report::export_csv(&paths, &session_id))
        .await
        .map_err(|error| format!("CSV export task failed: {error}"))?
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let paths = AppPaths::resolve(&app)?;
    let requested = PathBuf::from(path);
    let canonical_root = paths
        .root
        .canonicalize()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    let canonical_path = requested
        .canonicalize()
        .map_err(|error| format!("Path does not exist: {error}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Only files and folders inside the app data directory can be opened.".into());
    }
    app.opener()
        .open_path(canonical_path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("Could not open path: {error}"))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    pub description: Option<String>,
}

fn port_description(port_type: &serialport::SerialPortType) -> Option<String> {
    match port_type {
        serialport::SerialPortType::UsbPort(info) => {
            let mut parts = Vec::new();
            if let Some(product) = info.product.as_deref() {
                parts.push(product.to_string());
            }
            if let Some(manufacturer) = info.manufacturer.as_deref() {
                parts.push(manufacturer.to_string());
            }
            parts.push(format!("VID {:04X} · PID {:04X}", info.vid, info.pid));
            Some(parts.join(" · "))
        }
        serialport::SerialPortType::BluetoothPort => Some("Bluetooth serial port".into()),
        serialport::SerialPortType::PciPort => Some("PCI serial port".into()),
        serialport::SerialPortType::Unknown => None,
    }
}
