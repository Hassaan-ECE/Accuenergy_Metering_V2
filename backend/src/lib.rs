mod api;
mod domain;
mod meter_io;
mod monitor;
mod paths;
mod report;
mod review;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(monitor::MonitorManager::default())
        .invoke_handler(tauri::generate_handler![
            api::ping,
            api::get_config,
            api::save_config,
            api::list_serial_ports,
            api::get_app_paths,
            api::test_rs485,
            api::start_monitor,
            api::stop_monitor,
            api::get_monitor_state,
            api::generate_report,
            api::list_sessions,
            api::get_latest_session,
            api::load_session_review,
            api::load_csv_review,
            api::export_session_csv,
            api::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Accuenergy Metering");
}
