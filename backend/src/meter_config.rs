use std::{path::Path, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tokio_modbus::client::sync::{Reader, Writer};

use crate::{domain::config::AppConfig, meter_io};

pub const COMM_SETTINGS_START: u16 = 0x0FFE;
pub const COMM_SETTINGS_COUNT: u16 = 5;
pub const READ_FUNCTION_CODE: u8 = 0x03;
pub const WRITE_FUNCTION_CODE: u8 = 0x10;
pub const DEFAULT_PROTOCOL: u16 = 0;
pub const DEFAULT_PARITY_CODE: u16 = 3;
pub const DEFAULT_DEVICE_ID: u8 = 1;
pub const DEFAULT_BAUDRATE: u32 = 19_200;

const VERIFY_DELAY: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterCommSettings {
    pub protocol: u16,
    pub parity_code: u16,
    pub password: u16,
    pub device_id: u16,
    pub baudrate: u16,
}

impl MeterCommSettings {
    fn from_registers(registers: Vec<u16>) -> Result<Self, String> {
        if registers.len() != usize::from(COMM_SETTINGS_COUNT) {
            return Err(format!(
                "Expected {COMM_SETTINGS_COUNT} communication registers, received {}.",
                registers.len()
            ));
        }
        Ok(Self {
            protocol: registers[0],
            parity_code: registers[1],
            password: registers[2],
            device_id: registers[3],
            baudrate: registers[4],
        })
    }

    pub fn registers(&self) -> [u16; 5] {
        [
            self.protocol,
            self.parity_code,
            self.password,
            self.device_id,
            self.baudrate,
        ]
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyMeterDefaultsRequest {
    pub target_device_id: u8,
    pub target_baudrate: u32,
    pub isolated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterConfigPreview {
    pub register_start: u16,
    pub register_count: u16,
    pub read_function_code: u8,
    pub write_function_code: u8,
    pub default_device_id: u8,
    pub default_baudrate: u32,
    pub before: MeterCommSettings,
    pub after: MeterCommSettings,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyMeterDefaultsResult {
    pub before: MeterCommSettings,
    pub after: MeterCommSettings,
    pub verified: MeterCommSettings,
    pub config: AppConfig,
    pub summary: String,
}

pub fn preview(
    current_config: &AppConfig,
    target_device_id: u8,
    target_baudrate: u32,
) -> Result<MeterConfigPreview, String> {
    let before = read_meter_settings(current_config).map_err(|message| {
        format!("[FAIL] Dry-run read failed; no registers were written. {message}")
    })?;
    let after = target_settings(&before, target_device_id, target_baudrate)?;
    let summary = format!(
        "[PASS] Read FC {READ_FUNCTION_CODE:02X}H holding registers 0FFEH-1002H using {}.\nBefore: {}\nAfter:  {} (dry-run only; password preserved; no write)",
        describe_connection(current_config),
        format_registers(&before.registers()),
        format_registers(&after.registers()),
    );
    Ok(MeterConfigPreview {
        register_start: COMM_SETTINGS_START,
        register_count: COMM_SETTINGS_COUNT,
        read_function_code: READ_FUNCTION_CODE,
        write_function_code: WRITE_FUNCTION_CODE,
        default_device_id: DEFAULT_DEVICE_ID,
        default_baudrate: DEFAULT_BAUDRATE,
        before,
        after,
        summary,
    })
}

pub fn apply(
    current_config: &AppConfig,
    request: ApplyMeterDefaultsRequest,
    settings_path: &Path,
) -> Result<ApplyMeterDefaultsResult, String> {
    if !request.isolated {
        return Err(
            "Confirm that this meter is isolated from the RS485 daisy chain before applying communication settings."
                .into(),
        );
    }

    let before = read_meter_settings(current_config).map_err(|message| {
        format!("[FAIL] Pre-write read failed; no registers were written. {message}")
    })?;
    let after = target_settings(&before, request.target_device_id, request.target_baudrate)?;
    let target_config = target_app_config(
        current_config,
        request.target_device_id,
        request.target_baudrate,
    )?;

    if before == after {
        let verified = read_meter_settings(&target_config).map_err(|message| {
            format!(
                "[PASS] Current communication block already matches the target; no FC {WRITE_FUNCTION_CODE:02X}H write was sent.\n[FAIL] Verification at {} failed: {message}\nApp settings were not changed.",
                describe_connection(&target_config),
            )
        })?;
        if !settings_match_target(&verified, &after) {
            return Err(format!(
                "[PASS] Current communication block already matches the target; no FC {WRITE_FUNCTION_CODE:02X}H write was sent.\n[FAIL] Verification returned {}, expected {}.\nApp settings were not changed.",
                format_registers(&verified.registers()),
                format_registers(&after.registers()),
            ));
        }
        let saved_config = target_config.save(settings_path).map_err(|message| {
            format!(
                "[PASS] Meter already matches and verified at {} with registers {}.\n[FAIL] The app settings file could not be updated: {message}\nUpdate Settings manually before testing or monitoring.",
                describe_connection(&target_config),
                format_registers(&verified.registers()),
            )
        })?;
        let summary = format!(
            "[PASS] Current communication block already matches {}.\n[PASS] No FC {WRITE_FUNCTION_CODE:02X}H write was sent.\n[PASS] Verified over {}.\n[PASS] App settings updated to the verified meter connection.",
            format_registers(&after.registers()),
            describe_connection(&saved_config),
        );
        return Ok(ApplyMeterDefaultsResult {
            before,
            after,
            verified,
            config: saved_config,
            summary,
        });
    }

    write_meter_settings(current_config, &after).map_err(|message| {
        format!(
            "[PASS] Read current communication block: {}\n[FAIL] FC {WRITE_FUNCTION_CODE:02X}H write failed: {message}\nApp settings were not changed.",
            format_registers(&before.registers())
        )
    })?;

    thread::sleep(VERIFY_DELAY);
    let verified = read_meter_settings(&target_config).map_err(|message| {
        format!(
            "[PASS] Read current communication block: {}\n[PASS] FC {WRITE_FUNCTION_CODE:02X}H write was accepted.\n[FAIL] Verification at {} failed: {message}\nApp settings were not changed. The meter may now require the target settings.",
            format_registers(&before.registers()),
            describe_connection(&target_config),
        )
    })?;
    if !settings_match_target(&verified, &after) {
        return Err(format!(
            "[PASS] Read current communication block: {}\n[PASS] FC {WRITE_FUNCTION_CODE:02X}H write was accepted.\n[FAIL] Verification returned {}, expected {}.\nApp settings were not changed.",
            format_registers(&before.registers()),
            format_registers(&verified.registers()),
            format_registers(&after.registers()),
        ));
    }

    let saved_config = target_config.save(settings_path).map_err(|message| {
        format!(
            "[PASS] Meter verified at {} with registers {}.\n[FAIL] The app settings file could not be updated: {message}\nUpdate Settings manually before testing or monitoring.",
            describe_connection(&target_config),
            format_registers(&verified.registers()),
        )
    })?;
    let summary = format!(
        "[PASS] Read current communication block: {}\n[PASS] Wrote 0FFEH-1002H with FC {WRITE_FUNCTION_CODE:02X}H: {}\n[PASS] Verified over {}: {}\n[PASS] App settings updated to the verified meter connection.",
        format_registers(&before.registers()),
        format_registers(&after.registers()),
        describe_connection(&saved_config),
        format_registers(&verified.registers()),
    );

    Ok(ApplyMeterDefaultsResult {
        before,
        after,
        verified,
        config: saved_config,
        summary,
    })
}

fn read_meter_settings(config: &AppConfig) -> Result<MeterCommSettings, String> {
    let mut context = meter_io::connect(config)?;
    let mut last_error = None;
    for attempt in 0..=config.retries {
        match context.read_holding_registers(COMM_SETTINGS_START, COMM_SETTINGS_COUNT) {
            Ok(Ok(registers)) => return MeterCommSettings::from_registers(registers),
            Ok(Err(exception)) => {
                return Err(format!(
                    "Meter replied with Modbus exception {exception} while reading 0FFEH-1002H."
                ));
            }
            Err(error) => {
                last_error = Some(error.to_string());
                if attempt < config.retries {
                    continue;
                }
            }
        }
    }
    Err(format!(
        "Read of 0FFEH-1002H failed after {} attempt(s) using {}: {}",
        config.retries + 1,
        describe_connection(config),
        last_error.unwrap_or_else(|| "No response returned.".into()),
    ))
}

fn write_meter_settings(config: &AppConfig, settings: &MeterCommSettings) -> Result<(), String> {
    let mut context = meter_io::connect(config)?;
    match context.write_multiple_registers(COMM_SETTINGS_START, &settings.registers()) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(exception)) => Err(format!(
            "Meter replied with Modbus exception {exception} while writing 0FFEH-1002H."
        )),
        Err(error) => Err(format!(
            "Write to 0FFEH-1002H using {} failed: {error}",
            describe_connection(config)
        )),
    }
}

fn target_settings(
    before: &MeterCommSettings,
    target_device_id: u8,
    target_baudrate: u32,
) -> Result<MeterCommSettings, String> {
    if !(1..=247).contains(&target_device_id) {
        return Err("Target device ID must be between 1 and 247.".into());
    }
    let baudrate = u16::try_from(target_baudrate).map_err(|_| {
        "Target baud rate must be between 1 and 65535 because register 1002H is one 16-bit holding register."
            .to_string()
    })?;
    if baudrate == 0 {
        return Err("Target baud rate must be greater than 0.".into());
    }
    Ok(MeterCommSettings {
        protocol: DEFAULT_PROTOCOL,
        parity_code: DEFAULT_PARITY_CODE,
        password: before.password,
        device_id: u16::from(target_device_id),
        baudrate,
    })
}

fn target_app_config(
    current_config: &AppConfig,
    target_device_id: u8,
    target_baudrate: u32,
) -> Result<AppConfig, String> {
    AppConfig {
        baudrate: target_baudrate,
        device_id: target_device_id,
        parity: "N".into(),
        stop_bits: 1,
        ..current_config.clone()
    }
    .normalized()
}

fn settings_match_target(actual: &MeterCommSettings, expected: &MeterCommSettings) -> bool {
    actual.protocol == expected.protocol
        && actual.parity_code == expected.parity_code
        && actual.device_id == expected.device_id
        && actual.baudrate == expected.baudrate
}

fn describe_connection(config: &AppConfig) -> String {
    format!(
        "{}, device {}, {} baud, 8{}{}",
        config.port, config.device_id, config.baudrate, config.parity, config.stop_bits
    )
}

fn format_registers(registers: &[u16; 5]) -> String {
    format!(
        "[{}, {}, {}, {}, {}]",
        registers[0], registers[1], registers[2], registers[3], registers[4]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_block_and_function_codes_match_legacy_tool() {
        assert_eq!(COMM_SETTINGS_START, 0x0FFE);
        assert_eq!(COMM_SETTINGS_COUNT, 5);
        assert_eq!(COMM_SETTINGS_START + COMM_SETTINGS_COUNT - 1, 0x1002);
        assert_eq!(READ_FUNCTION_CODE, 0x03);
        assert_eq!(WRITE_FUNCTION_CODE, 0x10);
    }

    #[test]
    fn target_block_preserves_password_and_uses_lab_profile() {
        let before = MeterCommSettings {
            protocol: 1,
            parity_code: 0,
            password: 4_321,
            device_id: 9,
            baudrate: 9_600,
        };

        let target = target_settings(&before, 2, DEFAULT_BAUDRATE).unwrap();

        assert_eq!(target.registers(), [0, 3, 4_321, 2, 19_200]);
    }

    #[test]
    fn target_request_validation_rejects_unsupported_values() {
        let before = MeterCommSettings {
            protocol: 0,
            parity_code: 3,
            password: 0,
            device_id: 1,
            baudrate: 19_200,
        };

        assert_eq!(
            target_settings(&before, 0, DEFAULT_BAUDRATE).unwrap_err(),
            "Target device ID must be between 1 and 247."
        );
        assert!(target_settings(&before, 1, 115_200)
            .unwrap_err()
            .contains("16-bit holding register"));
    }

    #[test]
    fn verified_target_updates_only_app_communication_fields() {
        let current = AppConfig {
            theme_name: "dark".into(),
            port: "COM3".into(),
            baudrate: 9_600,
            device_id: 9,
            parity: "E".into(),
            stop_bits: 2,
            sample_hz: 5.0,
            run_hours: 2.0,
            commit_every: 25,
            timeout_seconds: 1.5,
            retries: 2,
        };

        let updated = target_app_config(&current, 2, DEFAULT_BAUDRATE).unwrap();

        assert_eq!(updated.port, "COM3");
        assert_eq!(updated.baudrate, 19_200);
        assert_eq!(updated.device_id, 2);
        assert_eq!(updated.parity, "N");
        assert_eq!(updated.stop_bits, 1);
        assert_eq!(updated.sample_hz, 5.0);
        assert_eq!(updated.run_hours, 2.0);
        assert_eq!(updated.commit_every, 25);
    }

    #[test]
    fn verification_matches_legacy_and_does_not_require_password_echo() {
        let expected = MeterCommSettings {
            protocol: 0,
            parity_code: 3,
            password: 4_321,
            device_id: 2,
            baudrate: 19_200,
        };
        let masked_password_readback = MeterCommSettings {
            password: 0,
            ..expected.clone()
        };

        assert!(settings_match_target(&masked_password_readback, &expected));
    }
}
