use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_modbus::{client::sync::Reader, Slave};
use tokio_serial::{DataBits, FlowControl, Parity, StopBits};

use crate::domain::{
    config::AppConfig,
    meter::{decode_float_be, MeterTarget, MeterValues, ACUVIM_BASIC_TARGETS},
};

pub type ModbusContext = tokio_modbus::client::sync::Context;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterReading {
    pub key: String,
    pub label: String,
    pub address: u16,
    pub unit: String,
    pub responded: bool,
    pub ok: bool,
    pub message: String,
    pub registers: Option<Vec<u16>>,
    pub value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterSnapshot {
    pub port: String,
    pub detected_ports: Vec<String>,
    pub connected: bool,
    pub any_meter_replied: bool,
    pub all_reads_ok: bool,
    pub message: String,
    pub readings: Vec<MeterReading>,
    pub values: MeterValues,
    pub summary: String,
}

pub fn connect(config: &AppConfig) -> Result<ModbusContext, String> {
    let parity = match config.parity.as_str() {
        "N" => Parity::None,
        "E" => Parity::Even,
        "O" => Parity::Odd,
        _ => return Err("Parity must be N, E, or O.".into()),
    };
    let stop_bits = if config.stop_bits == 2 {
        StopBits::Two
    } else {
        StopBits::One
    };
    let timeout = Duration::from_secs_f64(config.timeout_seconds);
    let builder = tokio_serial::new(&config.port, config.baudrate)
        .data_bits(DataBits::Eight)
        .flow_control(FlowControl::None)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(timeout);

    tokio_modbus::client::sync::rtu::connect_slave_with_timeout(
        &builder,
        Slave(config.device_id),
        Some(timeout),
    )
    .map_err(|error| {
        format!(
            "Could not connect to {}. Check cable, power, and COM settings. ({error})",
            config.port
        )
    })
}

pub fn read_basic_targets(context: &mut ModbusContext, config: &AppConfig) -> Vec<MeterReading> {
    read_basic_targets_until(context, config, || false)
}

pub fn read_basic_targets_until(
    context: &mut ModbusContext,
    config: &AppConfig,
    mut should_stop: impl FnMut() -> bool,
) -> Vec<MeterReading> {
    let mut readings = Vec::with_capacity(ACUVIM_BASIC_TARGETS.len());
    for target in ACUVIM_BASIC_TARGETS {
        if should_stop() {
            break;
        }
        readings.push(read_target(context, config, target));
    }
    readings
}

pub fn readings_to_values(readings: &[MeterReading]) -> MeterValues {
    let mut values = MeterValues::default();
    for reading in readings {
        values.set(&reading.key, if reading.ok { reading.value } else { None });
    }
    values
}

pub fn probe(config: &AppConfig) -> MeterSnapshot {
    let detected_ports = detected_port_names();
    match connect(config) {
        Ok(mut context) => {
            let readings = read_basic_targets(&mut context, config);
            let values = readings_to_values(&readings);
            let any_meter_replied = readings.iter().any(|reading| reading.responded);
            let all_reads_ok = !readings.is_empty() && readings.iter().all(|reading| reading.ok);
            let message = if any_meter_replied {
                "At least one meter value replied.".to_string()
            } else {
                "No devices replied. Check COM port, wiring polarity, baud/parity/stop bits, and slave ID."
                    .to_string()
            };
            let summary = format_snapshot(&config.port, &detected_ports, &message, &readings);
            MeterSnapshot {
                port: config.port.clone(),
                detected_ports,
                connected: true,
                any_meter_replied,
                all_reads_ok,
                message,
                readings,
                values,
                summary,
            }
        }
        Err(message) => {
            let summary = format_snapshot(&config.port, &detected_ports, &message, &[]);
            MeterSnapshot {
                port: config.port.clone(),
                detected_ports,
                connected: false,
                any_meter_replied: false,
                all_reads_ok: false,
                message,
                readings: Vec::new(),
                values: MeterValues::default(),
                summary,
            }
        }
    }
}

fn read_target(
    context: &mut ModbusContext,
    config: &AppConfig,
    target: &MeterTarget,
) -> MeterReading {
    let mut last_error = None;
    for attempt in 0..=config.retries {
        match context.read_holding_registers(target.address, 2) {
            Ok(Ok(registers)) => {
                if registers.len() != 2 {
                    return reading_error(
                        target,
                        true,
                        format!("Expected 2 registers, received {}.", registers.len()),
                        Some(registers),
                    );
                }
                let value = f64::from(decode_float_be([registers[0], registers[1]]));
                if !value.is_finite() {
                    return reading_error(
                        target,
                        true,
                        format!("Decoded a non-finite float: {value}"),
                        Some(registers),
                    );
                }
                return MeterReading {
                    key: target.key.into(),
                    label: target.label.into(),
                    address: target.address,
                    unit: target.unit.into(),
                    responded: true,
                    ok: true,
                    message: "Normal response.".into(),
                    registers: Some(registers),
                    value: Some(value),
                };
            }
            Ok(Err(exception)) => {
                return reading_error(
                    target,
                    true,
                    format!("Meter replied with Modbus exception {exception}."),
                    None,
                );
            }
            Err(error) => {
                last_error = Some(error.to_string());
                if attempt < config.retries {
                    continue;
                }
            }
        }
    }

    reading_error(
        target,
        false,
        format!(
            "Read failed after {} attempt(s): {}",
            config.retries + 1,
            last_error.unwrap_or_else(|| "No response returned.".into())
        ),
        None,
    )
}

fn reading_error(
    target: &MeterTarget,
    responded: bool,
    message: String,
    registers: Option<Vec<u16>>,
) -> MeterReading {
    MeterReading {
        key: target.key.into(),
        label: target.label.into(),
        address: target.address,
        unit: target.unit.into(),
        responded,
        ok: false,
        message,
        registers,
        value: None,
    }
}

fn detected_port_names() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|port| port.port_name).collect())
        .unwrap_or_default()
}

fn format_snapshot(
    port: &str,
    detected_ports: &[String],
    message: &str,
    readings: &[MeterReading],
) -> String {
    let detected = if detected_ports.is_empty() {
        "none".to_string()
    } else {
        detected_ports.join(", ")
    };
    let mut lines = vec![
        format!("Port: {port}"),
        format!("Detected ports: {detected}"),
        message.to_string(),
    ];
    if !readings.is_empty() {
        lines.push(String::new());
    }
    for reading in readings {
        let status = if reading.ok {
            "PASS"
        } else if reading.responded {
            "REPLIED"
        } else {
            "FAIL"
        };
        let detail = if let Some(value) = reading.value {
            let unit = if reading.unit.is_empty() {
                String::new()
            } else {
                format!(" {}", reading.unit)
            };
            format!("{value:.6}{unit}")
        } else {
            reading.message.clone()
        };
        lines.push(format!(
            "[{status}] {:<18} {detail}  (address {:04X}H)",
            reading.label, reading.address
        ));
    }
    lines.join("\n")
}
