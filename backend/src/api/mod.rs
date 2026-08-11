use crate::domain::config::AppConfig;

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    // Phase 2: load from app data dir settings.json
    AppConfig::default()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    config.validate()?;
    // Phase 2: persist to app data dir
    Ok(())
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<PortInfo>, String> {
    // Phase 2: serialport::available_ports()
    Ok(vec![PortInfo {
        name: "COM5".into(),
        description: Some("Placeholder — serialport crate not wired yet".into()),
    }])
}

#[tauri::command]
pub fn test_rs485() -> Result<String, String> {
    Err("Modbus RTU client not wired yet. See docs/PORT_PLAN.md Phase 2.".into())
}

#[tauri::command]
pub fn start_monitor() -> Result<(), String> {
    Err("Monitor loop not wired yet. Frontend uses demo stream for UI work.".into())
}

#[tauri::command]
pub fn stop_monitor() -> Result<(), String> {
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    pub description: Option<String>,
}
