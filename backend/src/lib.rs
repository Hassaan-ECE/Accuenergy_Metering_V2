mod api;
mod domain;
mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            api::ping,
            api::get_config,
            api::save_config,
            api::list_serial_ports,
            api::get_app_paths,
            api::test_rs485,
            api::start_monitor,
            api::stop_monitor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Accuenergy Metering");
}
