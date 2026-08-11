use std::{fs, path::Path};

use chrono::{DateTime, Local};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::domain::{config::AppConfig, meter::MeterValues};

const READING_COLUMNS: &str = "session_id, ts_unix, ts_iso, frequency_hz, phase_voltage_v1, phase_voltage_v2, phase_voltage_v3, line_voltage_v12, current_i1, current_i2, current_i3, active_power_p1, power_factor_pf1";

#[derive(Debug, Clone)]
pub struct ReadingRow {
    pub session_id: String,
    pub ts_unix: f64,
    pub ts_iso: String,
    pub values: MeterValues,
}

impl ReadingRow {
    pub fn new(session_id: &str, timestamp: DateTime<Local>, values: MeterValues) -> Self {
        Self {
            session_id: session_id.into(),
            ts_unix: timestamp.timestamp_millis() as f64 / 1000.0,
            ts_iso: timestamp.to_rfc3339(),
            values,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    pub stop_reason: Option<String>,
    pub sample_count: u64,
    pub error_count: u64,
    pub report_path: Option<String>,
    pub config: AppConfig,
}

pub fn connect(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create database directory: {error}"))?;
    }
    let connection = Connection::open(path)
        .map_err(|error| format!("Could not open SQLite database: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             CREATE TABLE IF NOT EXISTS readings (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL DEFAULT '',
                 ts_unix REAL NOT NULL,
                 ts_iso TEXT NOT NULL,
                 frequency_hz REAL,
                 phase_voltage_v1 REAL,
                 phase_voltage_v2 REAL,
                 phase_voltage_v3 REAL,
                 line_voltage_v12 REAL,
                 current_i1 REAL,
                 current_i2 REAL,
                 current_i3 REAL,
                 active_power_p1 REAL,
                 power_factor_pf1 REAL
             );
             CREATE TABLE IF NOT EXISTS sessions (
                 session_id TEXT PRIMARY KEY,
                 started_at TEXT NOT NULL,
                 ended_at TEXT,
                 status TEXT NOT NULL,
                 stop_reason TEXT,
                 sample_count INTEGER NOT NULL DEFAULT 0,
                 error_count INTEGER NOT NULL DEFAULT 0,
                 report_path TEXT,
                 config_json TEXT NOT NULL DEFAULT '{}'
             );
             CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts_unix);
             CREATE INDEX IF NOT EXISTS idx_readings_session_ts ON readings(session_id, ts_unix);",
        )
        .map_err(|error| format!("Could not initialize SQLite schema: {error}"))?;
    Ok(connection)
}

pub fn create_session(
    connection: &Connection,
    session_id: &str,
    started_at: DateTime<Local>,
    config: &AppConfig,
) -> Result<(), String> {
    let config_json = serde_json::to_string(config)
        .map_err(|error| format!("Could not serialize session settings: {error}"))?;
    connection
        .execute(
            "INSERT INTO sessions
             (session_id, started_at, ended_at, status, stop_reason, sample_count, error_count, report_path, config_json)
             VALUES (?1, ?2, NULL, 'running', NULL, 0, 0, NULL, ?3)",
            params![session_id, started_at.to_rfc3339(), config_json],
        )
        .map_err(|error| format!("Could not create session record: {error}"))?;
    Ok(())
}

pub fn flush_readings(
    connection: &mut Connection,
    batch: &mut Vec<ReadingRow>,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not begin SQLite batch: {error}"))?;
    {
        let mut statement = transaction
            .prepare(&format!(
                "INSERT INTO readings ({READING_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
            ))
            .map_err(|error| format!("Could not prepare SQLite insert: {error}"))?;
        for row in batch.iter() {
            statement
                .execute(params![
                    row.session_id,
                    row.ts_unix,
                    row.ts_iso,
                    row.values.frequency_hz,
                    row.values.phase_voltage_v1,
                    row.values.phase_voltage_v2,
                    row.values.phase_voltage_v3,
                    row.values.line_voltage_v12,
                    row.values.current_i1,
                    row.values.current_i2,
                    row.values.current_i3,
                    row.values.active_power_p1,
                    row.values.power_factor_pf1,
                ])
                .map_err(|error| format!("Could not insert meter reading: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not commit SQLite batch: {error}"))?;
    batch.clear();
    Ok(())
}

pub fn finalize_session(
    connection: &Connection,
    session_id: &str,
    ended_at: DateTime<Local>,
    status: &str,
    stop_reason: &str,
    sample_count: u64,
    error_count: u64,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE sessions
             SET ended_at = ?1, status = ?2, stop_reason = ?3, sample_count = ?4, error_count = ?5
             WHERE session_id = ?6",
            params![
                ended_at.to_rfc3339(),
                status,
                stop_reason,
                sample_count,
                error_count,
                session_id
            ],
        )
        .map_err(|error| format!("Could not finalize session record: {error}"))?;
    Ok(())
}

pub fn list_sessions(path: &Path, limit: usize) -> Result<Vec<SessionRecord>, String> {
    let connection = connect(path)?;
    let mut statement = connection
        .prepare(
            "SELECT session_id, started_at, ended_at, status, stop_reason, sample_count, error_count, report_path, config_json
             FROM sessions ORDER BY started_at DESC LIMIT ?1",
        )
        .map_err(|error| format!("Could not prepare session query: {error}"))?;
    let rows = statement
        .query_map([limit as i64], row_to_session)
        .map_err(|error| format!("Could not query sessions: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read session row: {error}"))
}

pub fn get_latest_session(path: &Path) -> Result<Option<SessionRecord>, String> {
    let connection = connect(path)?;
    connection
        .query_row(
            "SELECT session_id, started_at, ended_at, status, stop_reason, sample_count, error_count, report_path, config_json
             FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1",
            [],
            row_to_session,
        )
        .optional()
        .map_err(|error| format!("Could not query latest session: {error}"))
}

pub fn get_session(path: &Path, session_id: &str) -> Result<Option<SessionRecord>, String> {
    let connection = connect(path)?;
    connection
        .query_row(
            "SELECT session_id, started_at, ended_at, status, stop_reason, sample_count, error_count, report_path, config_json
             FROM sessions WHERE session_id = ?1",
            [session_id],
            row_to_session,
        )
        .optional()
        .map_err(|error| format!("Could not query session: {error}"))
}

pub fn load_readings(path: &Path, session_id: &str) -> Result<Vec<ReadingRow>, String> {
    let connection = connect(path)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT {READING_COLUMNS} FROM readings WHERE session_id = ?1 ORDER BY ts_unix"
        ))
        .map_err(|error| format!("Could not prepare readings query: {error}"))?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok(ReadingRow {
                session_id: row.get(0)?,
                ts_unix: row.get(1)?,
                ts_iso: row.get(2)?,
                values: MeterValues {
                    frequency_hz: row.get(3)?,
                    phase_voltage_v1: row.get(4)?,
                    phase_voltage_v2: row.get(5)?,
                    phase_voltage_v3: row.get(6)?,
                    line_voltage_v12: row.get(7)?,
                    current_i1: row.get(8)?,
                    current_i2: row.get(9)?,
                    current_i3: row.get(10)?,
                    active_power_p1: row.get(11)?,
                    power_factor_pf1: row.get(12)?,
                },
            })
        })
        .map_err(|error| format!("Could not query readings: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read meter row: {error}"))
}

pub fn update_report_path(path: &Path, session_id: &str, report_path: &Path) -> Result<(), String> {
    let connection = connect(path)?;
    connection
        .execute(
            "UPDATE sessions SET report_path = ?1 WHERE session_id = ?2",
            params![report_path.to_string_lossy(), session_id],
        )
        .map_err(|error| format!("Could not update report path: {error}"))?;
    Ok(())
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRecord> {
    let config_json: String = row.get(8)?;
    let config = serde_json::from_str(&config_json).unwrap_or_default();
    Ok(SessionRecord {
        session_id: row.get(0)?,
        started_at: row.get(1)?,
        ended_at: row.get(2)?,
        status: row.get(3)?,
        stop_reason: row.get(4)?,
        sample_count: row.get(5)?,
        error_count: row.get(6)?,
        report_path: row.get(7)?,
        config,
    })
}

#[cfg(test)]
mod tests {
    use chrono::Local;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn persists_session_and_readings() {
        let temp = tempdir().unwrap();
        let database = temp.path().join("meter.db");
        let mut connection = connect(&database).unwrap();
        let started = Local::now();
        create_session(&connection, "run_test", started, &AppConfig::default()).unwrap();

        let mut batch = vec![ReadingRow::new(
            "run_test",
            Local::now(),
            MeterValues {
                frequency_hz: Some(60.0),
                ..MeterValues::default()
            },
        )];
        flush_readings(&mut connection, &mut batch).unwrap();
        finalize_session(
            &connection,
            "run_test",
            Local::now(),
            "completed",
            "Run duration reached",
            1,
            0,
        )
        .unwrap();
        drop(connection);

        let session = get_latest_session(&database).unwrap().unwrap();
        assert_eq!(session.session_id, "run_test");
        assert_eq!(session.sample_count, 1);
        let readings = load_readings(&database, "run_test").unwrap();
        assert_eq!(readings.len(), 1);
        assert_eq!(readings[0].values.frequency_hz, Some(60.0));
    }
}
