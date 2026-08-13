use std::path::Path;

use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use csv::StringRecord;
use serde::Serialize;

use crate::{
    domain::{config::AppConfig, meter::MeterValues},
    paths::AppPaths,
    storage::{self, ReadingRow, SessionRecord},
};

pub const REVIEW_POINT_LIMIT: usize = 12_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDataset {
    pub source: String,
    pub source_label: String,
    pub session: SessionRecord,
    pub readings: Vec<ReadingRow>,
    pub original_reading_count: usize,
    pub config_available: bool,
}

pub fn load_session(paths: &AppPaths, session_id: &str) -> Result<ReviewDataset, String> {
    load_session_with_limit(paths, session_id, REVIEW_POINT_LIMIT)
}

fn load_session_with_limit(
    paths: &AppPaths,
    session_id: &str,
    maximum_points: usize,
) -> Result<ReviewDataset, String> {
    let session =
        storage::require_finalized_session(&paths.database, session_id, "reviewing the session")?;
    let readings = storage::load_readings(&paths.database, session_id)?;
    if readings.is_empty() {
        return Err("This session has no readings to review.".into());
    }
    let original_reading_count = readings.len();
    let config_available = session.config_available;
    Ok(ReviewDataset {
        source: "session".into(),
        source_label: paths.database.to_string_lossy().into_owned(),
        session,
        readings: downsample_readings(readings, maximum_points),
        original_reading_count,
        config_available,
    })
}

pub fn load_csv(path: &Path) -> Result<ReviewDataset, String> {
    load_csv_with_limit(path, REVIEW_POINT_LIMIT)
}

fn load_csv_with_limit(path: &Path, maximum_points: usize) -> Result<ReviewDataset, String> {
    if !path.is_file() {
        return Err("The selected CSV file does not exist or is not a regular file.".into());
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("csv"))
    {
        return Err("Select a .csv file exported by Accuenergy Metering.".into());
    }

    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|error| format!("Could not open CSV file: {error}"))?;
    let headers = reader
        .headers()
        .map_err(|error| format!("Could not read CSV header: {error}"))?
        .clone();
    let columns = CsvColumns::from_headers(&headers)?;
    let sidecar = load_settings_sidecar(path);

    let mut readings = Vec::new();
    let mut session_id: Option<String> = sidecar
        .as_ref()
        .map(|settings| settings.session_id.clone());
    let mut started_at: Option<String> = sidecar.as_ref().map(|settings| settings.started_at.clone());
    let mut ended_at: Option<String> = sidecar.as_ref().and_then(|settings| settings.ended_at.clone());
    let mut status: Option<String> = sidecar.as_ref().map(|settings| settings.status.clone());
    let mut stop_reason: Option<String> = sidecar
        .as_ref()
        .and_then(|settings| settings.stop_reason.clone());
    let mut sample_count: Option<u64> = sidecar.as_ref().map(|settings| settings.sample_count);
    let mut error_count: Option<u64> = sidecar.as_ref().map(|settings| settings.error_count);
    let mut config: Option<AppConfig> = sidecar.as_ref().map(|settings| settings.config.clone());

    for (record_index, record) in reader.records().enumerate() {
        let line_number = record_index + 2;
        let record =
            record.map_err(|error| format!("Could not read CSV row {line_number}: {error}"))?;
        if let Some(session_id_column) = columns.session_id {
            let row_session_id =
                required_text(&record, session_id_column, "session_id", line_number)?;
            match session_id.as_deref() {
                Some(expected) if expected != row_session_id => {
                    return Err(format!(
                        "CSV row {line_number} belongs to session {row_session_id}, expected {expected}."
                    ));
                }
                None => session_id = Some(row_session_id.to_string()),
                _ => {}
            }
        }

        let (ts_unix, ts_iso) = parse_row_timestamp(&record, &columns, line_number)?;
        let values = MeterValues {
            frequency_hz: parse_optional_f64(
                &record,
                columns.frequency_hz,
                "frequency_hz",
                line_number,
            )?,
            phase_voltage_v1: parse_optional_f64(
                &record,
                columns.phase_voltage_v1,
                "phase_voltage_v1",
                line_number,
            )?,
            phase_voltage_v2: parse_optional_f64(
                &record,
                columns.phase_voltage_v2,
                "phase_voltage_v2",
                line_number,
            )?,
            phase_voltage_v3: parse_optional_f64(
                &record,
                columns.phase_voltage_v3,
                "phase_voltage_v3",
                line_number,
            )?,
            line_voltage_v12: parse_optional_f64(
                &record,
                columns.line_voltage_v12,
                "line_voltage_v12",
                line_number,
            )?,
            current_i1: parse_optional_f64(&record, columns.current_i1, "current_i1", line_number)?,
            current_i2: parse_optional_f64(&record, columns.current_i2, "current_i2", line_number)?,
            current_i3: parse_optional_f64(&record, columns.current_i3, "current_i3", line_number)?,
            active_power_p1: parse_optional_f64(
                &record,
                columns.active_power_p1,
                "active_power_p1",
                line_number,
            )?,
            power_factor_pf1: parse_optional_f64(
                &record,
                columns.power_factor_pf1,
                "power_factor_pf1",
                line_number,
            )?,
        };
        if !values.any_value() {
            return Err(format!("CSV row {line_number} contains no meter values."));
        }
        readings.push(ReadingRow {
            session_id: session_id.clone().unwrap_or_else(|| "imported".into()),
            ts_unix,
            ts_iso,
            values,
        });

        if record_index == 0 {
            if let Some(value) = optional_text(&record, columns.session_started_at) {
                started_at = Some(value);
            }
            if let Some(value) = optional_text(&record, columns.session_ended_at) {
                ended_at = Some(value);
            }
            if let Some(value) = optional_text(&record, columns.session_status) {
                status = Some(value);
            }
            if let Some(value) = optional_text(&record, columns.session_stop_reason) {
                stop_reason = Some(value);
            }
            if let Some(value) = parse_optional_u64(
                &record,
                columns.session_sample_count,
                "session_sample_count",
                line_number,
            )? {
                sample_count = Some(value);
            }
            if let Some(value) = parse_optional_u64(
                &record,
                columns.session_error_count,
                "session_error_count",
                line_number,
            )? {
                error_count = Some(value);
            }
            if let Some(config_json) = optional_text(&record, columns.config_json) {
                config = Some(
                    serde_json::from_str::<AppConfig>(&config_json)
                        .map_err(|error| format!("CSV config_json is invalid: {error}"))?
                        .normalized()
                        .map_err(|error| format!("CSV config_json is invalid: {error}"))?,
                );
            }
        }
    }

    if readings.is_empty() {
        return Err("The selected CSV file contains no readings.".into());
    }

    let original_reading_count = readings.len();
    let first_timestamp = readings
        .first()
        .expect("readings are not empty")
        .ts_iso
        .clone();
    let last_timestamp = readings
        .last()
        .expect("readings are not empty")
        .ts_iso
        .clone();
    let config_available = config.is_some();
    let fallback_session_id = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "imported".into());
    let session = SessionRecord {
        session_id: session_id.unwrap_or(fallback_session_id),
        started_at: started_at.unwrap_or(first_timestamp),
        ended_at: Some(ended_at.unwrap_or(last_timestamp)),
        status: status.unwrap_or_else(|| "imported".into()),
        stop_reason: Some(stop_reason.unwrap_or_else(|| "Imported CSV".into())),
        sample_count: sample_count.unwrap_or(original_reading_count as u64),
        error_count: error_count.unwrap_or(0),
        report_path: None,
        config: config.unwrap_or_default(),
        config_available,
    };

    Ok(ReviewDataset {
        source: "csv".into(),
        source_label: path.to_string_lossy().into_owned(),
        session,
        readings: downsample_readings(readings, maximum_points),
        original_reading_count,
        config_available,
    })
}

struct CsvColumns {
    session_id: Option<usize>,
    session_started_at: Option<usize>,
    session_ended_at: Option<usize>,
    session_status: Option<usize>,
    session_stop_reason: Option<usize>,
    session_sample_count: Option<usize>,
    session_error_count: Option<usize>,
    config_json: Option<usize>,
    timestamp: Option<usize>,
    ts_unix: Option<usize>,
    ts_iso: Option<usize>,
    frequency_hz: usize,
    phase_voltage_v1: usize,
    phase_voltage_v2: usize,
    phase_voltage_v3: usize,
    line_voltage_v12: usize,
    current_i1: usize,
    current_i2: usize,
    current_i3: usize,
    active_power_p1: usize,
    power_factor_pf1: usize,
}

impl CsvColumns {
    fn from_headers(headers: &StringRecord) -> Result<Self, String> {
        let columns = Self {
            session_id: header_index(headers, "session_id"),
            session_started_at: header_index(headers, "session_started_at"),
            session_ended_at: header_index(headers, "session_ended_at"),
            session_status: header_index(headers, "session_status"),
            session_stop_reason: header_index(headers, "session_stop_reason"),
            session_sample_count: header_index(headers, "session_sample_count"),
            session_error_count: header_index(headers, "session_error_count"),
            config_json: header_index(headers, "config_json"),
            timestamp: header_index(headers, "timestamp"),
            ts_unix: header_index(headers, "ts_unix"),
            ts_iso: header_index(headers, "ts_iso"),
            frequency_hz: required_header(headers, "frequency_hz")?,
            phase_voltage_v1: required_header(headers, "phase_voltage_v1")?,
            phase_voltage_v2: required_header(headers, "phase_voltage_v2")?,
            phase_voltage_v3: required_header(headers, "phase_voltage_v3")?,
            line_voltage_v12: required_header(headers, "line_voltage_v12")?,
            current_i1: required_header(headers, "current_i1")?,
            current_i2: required_header(headers, "current_i2")?,
            current_i3: required_header(headers, "current_i3")?,
            active_power_p1: required_header(headers, "active_power_p1")?,
            power_factor_pf1: required_header(headers, "power_factor_pf1")?,
        };
        if columns.timestamp.is_none() && columns.ts_iso.is_none() && columns.ts_unix.is_none() {
            return Err(
                "CSV is missing a time column. Export again from this app or include 'timestamp'."
                    .into(),
            );
        }
        Ok(columns)
    }
}

fn parse_row_timestamp(
    record: &StringRecord,
    columns: &CsvColumns,
    line_number: usize,
) -> Result<(f64, String), String> {
    if let Some(index) = columns.timestamp {
        return parse_flexible_timestamp(
            required_text(record, index, "timestamp", line_number)?,
            line_number,
        );
    }
    if let Some(index) = columns.ts_iso {
        return parse_flexible_timestamp(
            required_text(record, index, "ts_iso", line_number)?,
            line_number,
        );
    }
    if let Some(index) = columns.ts_unix {
        let unix = parse_required_f64(record, index, "ts_unix", line_number)?;
        return Ok((unix, iso_from_unix(unix)));
    }
    Err(format!("CSV row {line_number} has no timestamp."))
}

fn parse_flexible_timestamp(text: &str, line_number: usize) -> Result<(f64, String), String> {
    if let Ok(unix) = text.parse::<f64>() {
        if unix.is_finite() {
            return Ok((unix, iso_from_unix(unix)));
        }
    }
    if let Ok(parsed) = DateTime::parse_from_rfc3339(text) {
        return Ok((parsed.timestamp_millis() as f64 / 1000.0, parsed.to_rfc3339()));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
        if let Some(local) = Local.from_local_datetime(&naive).single() {
            return Ok((local.timestamp_millis() as f64 / 1000.0, local.to_rfc3339()));
        }
    }
    Err(format!("CSV row {line_number} has an invalid timestamp: {text}"))
}

fn iso_from_unix(unix: f64) -> String {
    let seconds = unix.trunc() as i64;
    let nanos = ((unix.fract().abs()) * 1_000_000_000.0).round() as u32;
    TimeZone::timestamp_opt(&Local, seconds, nanos)
        .single()
        .map(|timestamp| timestamp.to_rfc3339())
        .unwrap_or_default()
}

fn load_settings_sidecar(csv_path: &Path) -> Option<crate::report::SessionSettingsFile> {
    let path = crate::report::settings_sidecar_path(csv_path);
    if !path.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn header_index(headers: &StringRecord, name: &str) -> Option<usize> {
    headers.iter().position(|header| header == name)
}

fn required_header(headers: &StringRecord, name: &str) -> Result<usize, String> {
    header_index(headers, name).ok_or_else(|| {
        format!("CSV is missing required column '{name}'. Export the session again from this app.")
    })
}

fn required_text<'a>(
    record: &'a StringRecord,
    index: usize,
    name: &str,
    line_number: usize,
) -> Result<&'a str, String> {
    let value = record.get(index).unwrap_or_default().trim();
    if value.is_empty() {
        Err(format!("CSV row {line_number} has an empty {name} value."))
    } else {
        Ok(value)
    }
}

fn optional_text(record: &StringRecord, index: Option<usize>) -> Option<String> {
    index
        .and_then(|column| record.get(column))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_required_f64(
    record: &StringRecord,
    index: usize,
    name: &str,
    line_number: usize,
) -> Result<f64, String> {
    let value = required_text(record, index, name, line_number)?
        .parse::<f64>()
        .map_err(|error| format!("CSV row {line_number} has invalid {name}: {error}"))?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(format!("CSV row {line_number} has non-finite {name}."))
    }
}

fn parse_optional_f64(
    record: &StringRecord,
    index: usize,
    name: &str,
    line_number: usize,
) -> Result<Option<f64>, String> {
    let raw = record.get(index).unwrap_or_default().trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let value = raw
        .parse::<f64>()
        .map_err(|error| format!("CSV row {line_number} has invalid {name}: {error}"))?;
    if value.is_finite() {
        Ok(Some(value))
    } else {
        Err(format!("CSV row {line_number} has non-finite {name}."))
    }
}

fn parse_optional_u64(
    record: &StringRecord,
    index: Option<usize>,
    name: &str,
    line_number: usize,
) -> Result<Option<u64>, String> {
    let Some(raw) = index.and_then(|column| record.get(column)).map(str::trim) else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse::<u64>()
        .map(Some)
        .map_err(|error| format!("CSV row {line_number} has invalid {name}: {error}"))
}

fn downsample_readings(readings: Vec<ReadingRow>, maximum_points: usize) -> Vec<ReadingRow> {
    if readings.len() <= maximum_points || maximum_points == 0 {
        return readings;
    }
    if maximum_points == 1 {
        return readings.into_iter().take(1).collect();
    }
    let last_index = readings.len() - 1;
    (0..maximum_points)
        .map(|index| readings[index * last_index / (maximum_points - 1)].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Local};
    use tempfile::tempdir;

    use super::*;
    use crate::{domain::config::AppConfig, domain::meter::MeterValues};

    #[test]
    fn loads_finalized_session_and_preserves_downsample_endpoints() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();
        let mut connection = storage::connect(&paths.database).unwrap();
        let started = Local::now();
        let config = AppConfig {
            port: "COM7".into(),
            device_id: 3,
            ..AppConfig::default()
        };
        storage::create_session(&connection, "run_review", started, &config).unwrap();
        let mut batch = (0..5)
            .map(|index| {
                ReadingRow::new(
                    "run_review",
                    started + Duration::seconds(index),
                    MeterValues {
                        frequency_hz: Some(60.0 + index as f64),
                        ..MeterValues::default()
                    },
                )
            })
            .collect::<Vec<_>>();
        storage::flush_readings(&mut connection, &mut batch).unwrap();
        storage::finalize_session(
            &connection,
            "run_review",
            started + Duration::seconds(4),
            "completed",
            "Run duration reached",
            5,
            0,
        )
        .unwrap();
        drop(connection);

        let review = load_session_with_limit(&paths, "run_review", 3).unwrap();

        assert_eq!(review.source, "session");
        assert_eq!(review.original_reading_count, 5);
        assert!(review.config_available);
        assert_eq!(review.session.config.port, "COM7");
        assert_eq!(review.session.config.device_id, 3);
        assert_eq!(review.readings.len(), 3);
        assert_eq!(review.readings[0].values.frequency_hz, Some(60.0));
        assert_eq!(review.readings[2].values.frequency_hz, Some(64.0));
    }

    #[test]
    fn loads_readings_when_database_session_config_is_invalid() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();
        let mut connection = storage::connect(&paths.database).unwrap();
        let started = Local::now();
        storage::create_session(
            &connection,
            "run_bad_config",
            started,
            &AppConfig::default(),
        )
        .unwrap();
        let mut batch = vec![ReadingRow::new(
            "run_bad_config",
            started,
            MeterValues {
                frequency_hz: Some(59.95),
                ..MeterValues::default()
            },
        )];
        storage::flush_readings(&mut connection, &mut batch).unwrap();
        storage::finalize_session(
            &connection,
            "run_bad_config",
            started + Duration::seconds(1),
            "stopped",
            "Stopped by user",
            1,
            0,
        )
        .unwrap();
        connection
            .execute(
                "UPDATE sessions SET config_json = 'not-json' WHERE session_id = ?1",
                ["run_bad_config"],
            )
            .unwrap();
        drop(connection);

        let review = load_session(&paths, "run_bad_config").unwrap();

        assert!(!review.config_available);
        assert!(!review.session.config_available);
        assert_eq!(review.readings.len(), 1);
        assert_eq!(review.readings[0].values.frequency_hz, Some(59.95));
    }

    #[test]
    fn rejects_running_session_review() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();
        let connection = storage::connect(&paths.database).unwrap();
        storage::create_session(
            &connection,
            "run_active",
            Local::now(),
            &AppConfig::default(),
        )
        .unwrap();
        drop(connection);

        let error = load_session(&paths, "run_active").unwrap_err();
        assert!(error.contains("not finalized"));
        assert!(error.contains("reviewing the session"));
    }

    #[test]
    fn reloads_exported_csv_with_session_config() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();
        let mut connection = storage::connect(&paths.database).unwrap();
        let started = Local::now();
        let config = AppConfig {
            port: "COM3".into(),
            device_id: 2,
            ..AppConfig::default()
        };
        storage::create_session(&connection, "run_csv", started, &config).unwrap();
        let mut batch = vec![ReadingRow::new(
            "run_csv",
            started,
            MeterValues {
                frequency_hz: Some(60.0),
                power_factor_pf1: Some(1.0),
                ..MeterValues::default()
            },
        )];
        storage::flush_readings(&mut connection, &mut batch).unwrap();
        storage::finalize_session(
            &connection,
            "run_csv",
            started + Duration::seconds(1),
            "stopped",
            "Stopped by user",
            1,
            3,
        )
        .unwrap();
        drop(connection);
        let csv_path = crate::report::export_csv(&paths, "run_csv", None).unwrap();

        let review = load_csv(&csv_path).unwrap();

        assert_eq!(review.source, "csv");
        assert!(review.config_available);
        assert_eq!(review.session.session_id, "run_csv");
        assert_eq!(review.session.config.port, "COM3");
        assert_eq!(review.session.config.device_id, 2);
        assert_eq!(review.session.error_count, 3);
        assert_eq!(review.readings[0].values.frequency_hz, Some(60.0));
    }

    #[test]
    fn rejects_csv_missing_required_columns() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("bad.csv");
        std::fs::write(
            &path,
            "frequency_hz,phase_voltage_v1,phase_voltage_v2,phase_voltage_v3,line_voltage_v12,current_i1,current_i2,current_i3,active_power_p1,power_factor_pf1\n60,120,120,120,208,1,1,1,120,1\n",
        )
        .unwrap();

        let error = load_csv(&path).unwrap_err();

        assert!(error.contains("missing a time column"));
    }
}
