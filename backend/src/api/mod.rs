use crate::domain::config::AppConfig;
use crate::paths::AppPaths;
use tauri::AppHandle;

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
