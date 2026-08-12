use std::path::Path;

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
    Ok(ReviewDataset {
        source: "session".into(),
        source_label: paths.database.to_string_lossy().into_owned(),
        session,
        readings: downsample_readings(readings, maximum_points),
        original_reading_count,
        config_available: true,
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

    let mut readings = Vec::new();
    let mut session_id: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut ended_at: Option<String> = None;
    let mut status: Option<String> = None;
    let mut stop_reason: Option<String> = None;
    let mut sample_count: Option<u64> = None;
    let mut error_count: Option<u64> = None;
    let mut config: Option<AppConfig> = None;

    for (record_index, record) in reader.records().enumerate() {
        let line_number = record_index + 2;
        let record =
            record.map_err(|error| format!("Could not read CSV row {line_number}: {error}"))?;
        let row_session_id = required_text(&record, columns.session_id, "session_id", line_number)?;
        match session_id.as_deref() {
            Some(expected) if expected != row_session_id => {
                return Err(format!(
                    "CSV row {line_number} belongs to session {row_session_id}, expected {expected}."
                ));
            }
            None => session_id = Some(row_session_id.to_string()),
            _ => {}
        }

        let ts_unix = parse_required_f64(&record, columns.ts_unix, "ts_unix", line_number)?;
        let ts_iso = required_text(&record, columns.ts_iso, "ts_iso", line_number)?.to_string();
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
            session_id: row_session_id.to_string(),
            ts_unix,
            ts_iso,
            values,
        });

        if record_index == 0 {
            started_at = optional_text(&record, columns.session_started_at);
            ended_at = optional_text(&record, columns.session_ended_at);
            status = optional_text(&record, columns.session_status);
            stop_reason = optional_text(&record, columns.session_stop_reason);
            sample_count = parse_optional_u64(
                &record,
                columns.session_sample_count,
                "session_sample_count",
                line_number,
            )?;
            error_count = parse_optional_u64(
                &record,
                columns.session_error_count,
                "session_error_count",
                line_number,
            )?;
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
    let session = SessionRecord {
        session_id: session_id.expect("a reading supplies a session id"),
        started_at: started_at.unwrap_or(first_timestamp),
        ended_at: Some(ended_at.unwrap_or(last_timestamp)),
        status: status.unwrap_or_else(|| "imported".into()),
        stop_reason: Some(stop_reason.unwrap_or_else(|| "Imported CSV".into())),
        sample_count: sample_count.unwrap_or(original_reading_count as u64),
        error_count: error_count.unwrap_or(0),
        report_path: None,
        config: config.unwrap_or_default(),
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
    session_id: usize,
    session_started_at: Option<usize>,
    session_ended_at: Option<usize>,
    session_status: Option<usize>,
    session_stop_reason: Option<usize>,
    session_sample_count: Option<usize>,
    session_error_count: Option<usize>,
    config_json: Option<usize>,
    ts_unix: usize,
    ts_iso: usize,
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
        Ok(Self {
            session_id: required_header(headers, "session_id")?,
            session_started_at: header_index(headers, "session_started_at"),
            session_ended_at: header_index(headers, "session_ended_at"),
            session_status: header_index(headers, "session_status"),
            session_stop_reason: header_index(headers, "session_stop_reason"),
            session_sample_count: header_index(headers, "session_sample_count"),
            session_error_count: header_index(headers, "session_error_count"),
            config_json: header_index(headers, "config_json"),
            ts_unix: required_header(headers, "ts_unix")?,
            ts_iso: required_header(headers, "ts_iso")?,
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
        })
    }
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
        storage::create_session(&connection, "run_review", started, &AppConfig::default()).unwrap();
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
        assert_eq!(review.readings.len(), 3);
        assert_eq!(review.readings[0].values.frequency_hz, Some(60.0));
        assert_eq!(review.readings[2].values.frequency_hz, Some(64.0));
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
        let csv_path = crate::report::export_csv(&paths, "run_csv").unwrap();

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
        std::fs::write(&path, "session_id,ts_unix\nrun_bad,1\n").unwrap();

        let error = load_csv(&path).unwrap_err();

        assert!(error.contains("missing required column 'ts_iso'"));
    }
}
