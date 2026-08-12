use std::{fs, io::ErrorKind, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme_name: String,
    pub port: String,
    pub baudrate: u32,
    pub device_id: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub sample_hz: f64,
    pub run_hours: f64,
    pub commit_every: u32,
    pub timeout_seconds: f64,
    pub retries: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme_name: "light".into(),
            port: "COM5".into(),
            baudrate: 19200,
            device_id: 1,
            parity: "N".into(),
            stop_bits: 1,
            sample_hz: 1.0,
            run_hours: 24.0,
            commit_every: 50,
            timeout_seconds: 1.0,
            retries: 1,
        }
    }
}

impl AppConfig {
    pub fn sample_interval_secs(&self) -> f64 {
        if self.sample_hz <= 0.0 {
            0.0
        } else {
            1.0 / self.sample_hz
        }
    }

    pub fn normalized(mut self) -> Result<Self, String> {
        self.theme_name = self.theme_name.trim().to_ascii_lowercase();
        self.parity = self.parity.trim().to_ascii_uppercase();
        self.port = self.port.trim().to_string();
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.theme_name != "light" && self.theme_name != "dark" {
            return Err("Theme must be light or dark.".into());
        }
        if self.port.trim().is_empty() {
            return Err("COM port is required.".into());
        }
        if self.baudrate == 0 {
            return Err("Baud rate must be greater than 0.".into());
        }
        if !(1..=247).contains(&self.device_id) {
            return Err("Device ID must be between 1 and 247.".into());
        }
        if !matches!(self.parity.as_str(), "N" | "E" | "O") {
            return Err("Parity must be N, E, or O.".into());
        }
        if self.stop_bits != 1 && self.stop_bits != 2 {
            return Err("Stop bits must be 1 or 2.".into());
        }
        if !self.sample_hz.is_finite() || self.sample_hz < 0.0 {
            return Err("Sample rate cannot be negative.".into());
        }
        if !self.run_hours.is_finite() || self.run_hours < 0.0 {
            return Err("Run hours cannot be negative.".into());
        }
        if self.commit_every == 0 {
            return Err("Commit every must be greater than 0.".into());
        }
        if !self.timeout_seconds.is_finite() || self.timeout_seconds <= 0.0 {
            return Err("Timeout must be greater than 0.".into());
        }
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("Could not read settings file: {error}"))?;
        let loaded: Self = serde_json::from_str(&raw)
            .map_err(|error| format!("Settings file is invalid JSON: {error}"))?;
        loaded.normalized()
    }

    pub fn save(&self, path: &Path) -> Result<Self, String> {
        let normalized = self.clone().normalized()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create settings directory: {error}"))?;
        }
        let payload = serde_json::to_string_pretty(&normalized)
            .map_err(|error| format!("Could not serialize settings: {error}"))?;
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Settings path must end with a valid file name.".to_string())?;
        let temp_path = path.with_file_name(format!("{file_name}.tmp"));
        fs::write(&temp_path, payload)
            .map_err(|error| format!("Could not write temporary settings file: {error}"))?;

        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Could not replace the existing settings file: {error}. Settings were not saved; the temporary file may remain at {}.",
                    temp_path.display()
                ));
            }
        }
        fs::rename(&temp_path, path).map_err(|error| {
            format!(
                "Could not install the new settings file: {error}. Settings were not saved; the temporary file may remain at {}.",
                temp_path.display()
            )
        })?;
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::AppConfig;
    use std::fs;

    fn temp_settings_path(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "accuenergy-config-tests-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory.join("settings.json")
    }

    #[test]
    fn accepts_lab_defaults() {
        assert!(AppConfig::default().validate().is_ok());
    }

    #[test]
    fn rejects_invalid_device_id_and_parity() {
        let mut config = AppConfig {
            device_id: 248,
            ..AppConfig::default()
        };
        assert_eq!(
            config.validate().unwrap_err(),
            "Device ID must be between 1 and 247."
        );

        config.device_id = 1;
        config.parity = "X".into();
        assert_eq!(config.validate().unwrap_err(), "Parity must be N, E, or O.");
    }

    #[test]
    fn normalizes_user_text() {
        let config = AppConfig {
            theme_name: " Dark ".into(),
            port: " COM7 ".into(),
            parity: "e".into(),
            ..AppConfig::default()
        }
        .normalized()
        .unwrap();

        assert_eq!(config.theme_name, "dark");
        assert_eq!(config.port, "COM7");
        assert_eq!(config.parity, "E");
    }

    #[test]
    fn missing_settings_load_defaults() {
        let path = temp_settings_path("missing");

        let loaded = AppConfig::load(&path).unwrap();

        assert_eq!(loaded.port, AppConfig::default().port);
        assert_eq!(loaded.device_id, AppConfig::default().device_id);
    }

    #[test]
    fn valid_settings_are_loaded_and_normalized() {
        let path = temp_settings_path("valid");
        fs::write(
            &path,
            serde_json::to_string(&AppConfig {
                theme_name: " Dark ".into(),
                port: " COM9 ".into(),
                parity: "e".into(),
                ..AppConfig::default()
            })
            .unwrap(),
        )
        .unwrap();

        let loaded = AppConfig::load(&path).unwrap();

        assert_eq!(loaded.theme_name, "dark");
        assert_eq!(loaded.port, "COM9");
        assert_eq!(loaded.parity, "E");
    }

    #[test]
    fn invalid_json_is_reported() {
        let path = temp_settings_path("invalid-json");
        fs::write(&path, "{not-json").unwrap();

        let error = AppConfig::load(&path).unwrap_err();

        assert!(error.contains("Settings file is invalid JSON"));
    }

    #[test]
    fn invalid_loaded_config_is_reported() {
        let path = temp_settings_path("invalid-device");
        fs::write(
            &path,
            serde_json::to_string(&AppConfig {
                device_id: 0,
                ..AppConfig::default()
            })
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            AppConfig::load(&path).unwrap_err(),
            "Device ID must be between 1 and 247."
        );
    }

    #[test]
    fn save_round_trips_and_removes_temporary_file() {
        let path = temp_settings_path("round-trip");
        let config = AppConfig {
            theme_name: " Dark ".into(),
            port: " COM8 ".into(),
            parity: "o".into(),
            ..AppConfig::default()
        };

        let saved = config.save(&path).unwrap();
        let loaded = AppConfig::load(&path).unwrap();

        assert_eq!(saved.theme_name, "dark");
        assert_eq!(loaded.port, "COM8");
        assert_eq!(loaded.parity, "O");
        assert!(!path.with_file_name("settings.json.tmp").exists());
    }
}
