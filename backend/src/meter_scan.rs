use std::path::Path;

use serde::Serialize;
use tokio_modbus::client::sync::Reader;

use crate::domain::config::AppConfig;
use crate::meter_io;

const SCAN_TIMEOUT_SECONDS: f64 = 0.3;
const SCAN_ADDRESS: u16 = 0x4000;
const SCAN_COUNT: u16 = 2;
const LAB_DEVICE_IDS: [u8; 10] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COMMON_BAUDS: [u32; 5] = [19_200, 9_600, 38_400, 4_800, 115_200];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanCandidate {
    pub port: String,
    pub baudrate: u32,
    pub device_id: u8,
    pub parity: String,
    pub stop_bits: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterDetectHit {
    pub port: String,
    pub baudrate: u32,
    pub device_id: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterDetectResult {
    pub found: bool,
    pub attempts: u32,
    pub hits: Vec<MeterDetectHit>,
    pub config: Option<AppConfig>,
    pub summary: String,
}

pub fn detect(current: &AppConfig, settings_path: &Path) -> Result<MeterDetectResult, String> {
    let ports = discover_ports(&current.port);
    if ports.is_empty() {
        return Err(
            "No serial ports were detected. Plug in the USB–RS485 adapter and try Detect again."
                .into(),
        );
    }

    let mut check = current.clone();
    if check.port.trim().is_empty() {
        check.port = ports[0].clone();
    }
    check.validate()?;

    let mut attempts = 0_u32;
    let mut hits = Vec::new();
    let mut skipped_ports = Vec::new();
    let mut scanned_combo: Option<(String, u32, String, u8)> = None;

    for candidate in scan_candidates(&check, &ports) {
        if let Some((port, baud, parity, stop)) = scanned_combo.as_ref() {
            if candidate.port != *port
                || candidate.baudrate != *baud
                || candidate.parity != *parity
                || candidate.stop_bits != *stop
            {
                break;
            }
        }

        if skipped_ports
            .iter()
            .any(|port: &String| ports_equal(port, &candidate.port))
        {
            continue;
        }

        attempts += 1;
        let probe_config = scan_config(&check, &candidate);
        match probe_once(&probe_config) {
            Ok(Some(message)) => {
                hits.push(MeterDetectHit {
                    port: candidate.port.clone(),
                    baudrate: candidate.baudrate,
                    device_id: candidate.device_id,
                    parity: candidate.parity.clone(),
                    stop_bits: candidate.stop_bits,
                    message,
                });
                scanned_combo = Some((
                    candidate.port.clone(),
                    candidate.baudrate,
                    candidate.parity.clone(),
                    candidate.stop_bits,
                ));
            }
            Ok(None) => {}
            Err(_) => {
                if !skipped_ports
                    .iter()
                    .any(|port: &String| ports_equal(port, &candidate.port))
                {
                    skipped_ports.push(candidate.port.clone());
                }
            }
        }
    }

    if hits.is_empty() {
        let skipped = if skipped_ports.is_empty() {
            String::new()
        } else {
            format!(" Could not open: {}.", skipped_ports.join(", "))
        };
        return Ok(MeterDetectResult {
            found: false,
            attempts,
            hits,
            config: None,
            summary: format!(
                "[FAIL] No meter replied on {} after {attempts} read-only probes (FC03 4000H). Check cable and polarity.{skipped}",
                ports.join(", ")
            ),
        });
    }

    let applied = apply_detected_settings(&check, &hits, settings_path)?;
    let mut lines = vec![format!(
        "[PASS] Detected {} meter(s) on {} after {attempts} probe(s).",
        hits.len(),
        applied.port
    )];
    for hit in &hits {
        lines.push(format!(
            "[PASS] {} · {} baud, 8{}{}, device {}: {}",
            hit.port, hit.baudrate, hit.parity, hit.stop_bits, hit.device_id, hit.message
        ));
    }
    if hits.len() > 1 {
        lines.push(format!(
            "Multiple devices answered. App settings now use {}, device {}.",
            applied.port, applied.device_id
        ));
    } else {
        lines.push(format!(
            "[PASS] App settings updated to {}, device {}, {} baud, 8{}{}.",
            applied.port, applied.device_id, applied.baudrate, applied.parity, applied.stop_bits
        ));
    }

    Ok(MeterDetectResult {
        found: true,
        attempts,
        hits,
        config: Some(applied),
        summary: lines.join("\n"),
    })
}

pub fn discover_ports(preferred: &str) -> Vec<String> {
    let available = serialport::available_ports()
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| port.port_name)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    order_ports(preferred, available)
}

pub fn order_ports(preferred: &str, available: impl IntoIterator<Item = impl Into<String>>) -> Vec<String> {
    let mut ports = available.into_iter().map(Into::into).collect::<Vec<_>>();
    ports.sort_by(|left, right| compare_port_names(left, right));

    let preferred = preferred.trim();
    if !preferred.is_empty() {
        ports.retain(|port| !ports_equal(port, preferred));
        ports.insert(0, preferred.to_string());
    }
    ports
}

pub fn scan_candidates(current: &AppConfig, ports: &[String]) -> Vec<ScanCandidate> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut push = |port: &str, baudrate: u32, parity: &str, stop_bits: u8, device_id: u8| {
        let key = (
            port.to_ascii_uppercase(),
            baudrate,
            parity.to_string(),
            stop_bits,
            device_id,
        );
        if seen.insert(key) {
            candidates.push(ScanCandidate {
                port: port.to_string(),
                baudrate,
                device_id,
                parity: parity.to_string(),
                stop_bits,
            });
        }
    };

    let mut ids = vec![current.device_id];
    for id in LAB_DEVICE_IDS {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    for port in ports {
        for id in &ids {
            push(port, current.baudrate, &current.parity, current.stop_bits, *id);
        }
        for baud in COMMON_BAUDS {
            for id in &ids {
                push(port, baud, "N", 1, *id);
            }
        }
        for baud in COMMON_BAUDS {
            for parity in ["E", "O"] {
                for id in [1_u8, 2] {
                    push(port, baud, parity, 1, id);
                }
            }
        }
        for baud in [19_200_u32, 9_600] {
            for id in [1_u8, 2] {
                push(port, baud, "N", 2, id);
            }
        }
    }

    candidates
}

fn scan_config(current: &AppConfig, candidate: &ScanCandidate) -> AppConfig {
    AppConfig {
        port: candidate.port.clone(),
        baudrate: candidate.baudrate,
        device_id: candidate.device_id,
        parity: candidate.parity.clone(),
        stop_bits: candidate.stop_bits,
        timeout_seconds: SCAN_TIMEOUT_SECONDS,
        retries: 0,
        ..current.clone()
    }
}

fn ports_equal(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn compare_port_names(left: &str, right: &str) -> std::cmp::Ordering {
    port_sort_key(left).cmp(&port_sort_key(right))
}

fn port_sort_key(name: &str) -> (String, u32) {
    let upper = name.trim().to_ascii_uppercase();
    let prefix_len = upper
        .chars()
        .take_while(|character| !character.is_ascii_digit())
        .count();
    let number = upper[prefix_len..].parse::<u32>().unwrap_or(0);
    (upper[..prefix_len].to_string(), number)
}

fn probe_once(config: &AppConfig) -> Result<Option<String>, String> {
    let mut context = meter_io::connect(config)?;
    match context.read_holding_registers(SCAN_ADDRESS, SCAN_COUNT) {
        Ok(Ok(registers)) if registers.len() == 2 => {
            Ok(Some(format!("Holding 4000H replied ({}, {}).", registers[0], registers[1])))
        }
        Ok(Ok(registers)) => Ok(Some(format!(
            "Meter replied with {} register(s) at 4000H.",
            registers.len()
        ))),
        Ok(Err(exception)) => Ok(Some(format!("Meter replied with Modbus exception {exception}."))),
        Err(_) => Ok(None),
    }
}

fn apply_detected_settings(
    current: &AppConfig,
    hits: &[MeterDetectHit],
    settings_path: &Path,
) -> Result<AppConfig, String> {
    let chosen = choose_hit(&current.port, current.device_id, hits)
        .ok_or_else(|| "Detect found no usable meter settings.".to_string())?;
    AppConfig {
        port: chosen.port.clone(),
        baudrate: chosen.baudrate,
        device_id: chosen.device_id,
        parity: chosen.parity.clone(),
        stop_bits: chosen.stop_bits,
        ..current.clone()
    }
    .save(settings_path)
}

pub fn choose_hit<'a>(
    preferred_port: &str,
    preferred_device_id: u8,
    hits: &'a [MeterDetectHit],
) -> Option<&'a MeterDetectHit> {
    let preferred_port_hit = hits.iter().any(|hit| ports_equal(&hit.port, preferred_port));
    hits.iter()
        .filter(|hit| !preferred_port_hit || ports_equal(&hit.port, preferred_port))
        .min_by_key(|hit| {
            (
                u8::from(hit.device_id != preferred_device_id),
                hit.device_id,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_connection_is_tried_before_other_ids() {
        let current = AppConfig {
            device_id: 2,
            baudrate: 19_200,
            parity: "N".into(),
            stop_bits: 1,
            ..AppConfig::default()
        };
        let candidates = scan_candidates(&current, &["COM5".into(), "COM3".into()]);
        assert_eq!(candidates[0].port, "COM5");
        assert_eq!(candidates[0].device_id, 2);
        assert_eq!(candidates[0].baudrate, 19_200);
        assert!(candidates.iter().any(|candidate| candidate.port == "COM3"));
        assert!(candidates.iter().any(|candidate| candidate.device_id == 1));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.baudrate == 9_600 && candidate.parity == "N"));
    }

    #[test]
    fn preferred_port_is_listed_first() {
        assert_eq!(order_ports("COM7", ["COM3", "COM7"])[0], "COM7");
        assert_eq!(order_ports("", ["COM10", "COM3"])[0], "COM3");
    }

    #[test]
    fn choose_hit_keeps_current_id_when_several_reply() {
        let hits = vec![
            MeterDetectHit {
                port: "COM3".into(),
                baudrate: 19_200,
                device_id: 1,
                parity: "N".into(),
                stop_bits: 1,
                message: "ok".into(),
            },
            MeterDetectHit {
                port: "COM3".into(),
                baudrate: 19_200,
                device_id: 2,
                parity: "N".into(),
                stop_bits: 1,
                message: "ok".into(),
            },
        ];
        assert_eq!(choose_hit("COM3", 2, &hits).unwrap().device_id, 2);
        assert_eq!(choose_hit("COM3", 9, &hits).unwrap().device_id, 1);
        assert_eq!(choose_hit("COM8", 2, &hits).unwrap().device_id, 2);
    }
}
