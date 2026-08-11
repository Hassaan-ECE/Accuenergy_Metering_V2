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

    pub fn validate(&self) -> Result<(), String> {
        if self.port.trim().is_empty() {
            return Err("COM port is required.".into());
        }
        if self.baudrate == 0 {
            return Err("Baud rate must be greater than 0.".into());
        }
        if self.device_id == 0 {
            return Err("Device ID must be greater than 0.".into());
        }
        if self.stop_bits != 1 && self.stop_bits != 2 {
            return Err("Stop bits must be 1 or 2.".into());
        }
        if self.sample_hz < 0.0 {
            return Err("Sample rate cannot be negative.".into());
        }
        if self.run_hours < 0.0 {
            return Err("Run hours cannot be negative.".into());
        }
        if self.commit_every == 0 {
            return Err("Commit every must be greater than 0.".into());
        }
        if self.timeout_seconds <= 0.0 {
            return Err("Timeout must be greater than 0.".into());
        }
        Ok(())
    }
}
