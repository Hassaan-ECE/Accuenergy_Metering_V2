use std::{fs, path::Path};

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
        fs::write(path, payload)
            .map_err(|error| format!("Could not write settings file: {error}"))?;
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::AppConfig;

    #[test]
    fn accepts_lab_defaults() {
        assert!(AppConfig::default().validate().is_ok());
    }

    #[test]
    fn rejects_invalid_device_id_and_parity() {
        let mut config = AppConfig::default();
        config.device_id = 248;
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
}
