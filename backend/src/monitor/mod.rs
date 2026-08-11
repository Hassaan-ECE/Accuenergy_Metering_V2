use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use chrono::{DateTime, Duration as ChronoDuration, Local};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    domain::{config::AppConfig, meter::MeterValues},
    meter_io,
    paths::AppPaths,
    storage::{self, ReadingRow},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveUpdate {
    pub session_id: String,
    pub timestamp_ms: i64,
    pub values: MeterValues,
    pub sample_count: u64,
    pub error_count: u64,
    pub live_hz: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorLog {
    pub timestamp_ms: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub started_at: String,
    pub ended_at: String,
    pub sample_count: u64,
    pub error_count: u64,
    pub stop_reason: String,
    pub status: String,
    pub database_path: String,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorFailure {
    pub kind: String,
    pub message: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMonitorResult {
    pub session_id: String,
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorState {
    pub running: bool,
    pub session_id: Option<String>,
}

#[derive(Clone, Default)]
pub struct MonitorManager {
    active: Arc<Mutex<Option<ActiveMonitor>>>,
}

#[derive(Clone)]
struct ActiveMonitor {
    session_id: String,
    stop: Arc<AtomicBool>,
}

impl MonitorManager {
    pub fn start(
        &self,
        app: AppHandle,
        paths: AppPaths,
        config: AppConfig,
    ) -> Result<StartMonitorResult, String> {
        config.validate()?;
        let started_at = Local::now();
        let session_id = session_id(started_at);
        let stop = Arc::new(AtomicBool::new(false));
        {
            let mut active = self
                .active
                .lock()
                .map_err(|_| "Monitor state is unavailable.")?;
            if let Some(current) = active.as_ref() {
                return Err(format!(
                    "A monitor session is already running: {}",
                    current.session_id
                ));
            }
            *active = Some(ActiveMonitor {
                session_id: session_id.clone(),
                stop: stop.clone(),
            });
        }

        let manager = self.clone();
        let thread_session_id = session_id.clone();
        let database_path = paths.database.to_string_lossy().into_owned();
        let spawn_result = thread::Builder::new()
            .name(format!("meter-{thread_session_id}"))
            .spawn(move || {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    run_monitor_session(
                        &app,
                        &paths,
                        &config,
                        &thread_session_id,
                        started_at,
                        &stop,
                    )
                }));
                match result {
                    Ok(Ok(summary)) => {
                        let _ = app.emit("monitor-finished", summary);
                    }
                    Ok(Err(failure)) => {
                        let _ = app.emit("monitor-failed", failure);
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "monitor-failed",
                            MonitorFailure {
                                kind: "runtime".into(),
                                message: "The monitor thread terminated unexpectedly.".into(),
                                session_id: Some(thread_session_id.clone()),
                            },
                        );
                    }
                }
                manager.clear(&thread_session_id);
            });

        if let Err(error) = spawn_result {
            self.clear(&session_id);
            return Err(format!("Could not start monitor thread: {error}"));
        }

        Ok(StartMonitorResult {
            session_id,
            database_path,
        })
    }

    pub fn stop(&self) -> Result<Option<String>, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Monitor state is unavailable.")?;
        if let Some(active) = active.as_ref() {
            active.stop.store(true, Ordering::SeqCst);
            Ok(Some(active.session_id.clone()))
        } else {
            Ok(None)
        }
    }

    pub fn state(&self) -> Result<MonitorState, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Monitor state is unavailable.")?;
        Ok(MonitorState {
            running: active.is_some(),
            session_id: active.as_ref().map(|monitor| monitor.session_id.clone()),
        })
    }

    fn clear(&self, session_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if active
                .as_ref()
                .is_some_and(|monitor| monitor.session_id == session_id)
            {
                *active = None;
            }
        }
    }
}

fn run_monitor_session(
    app: &AppHandle,
    paths: &AppPaths,
    config: &AppConfig,
    session_id: &str,
    started_at: DateTime<Local>,
    stop: &AtomicBool,
) -> Result<SessionSummary, MonitorFailure> {
    let mut connection = storage::connect(&paths.database)
        .map_err(|message| runtime_failure(Some(session_id), message))?;
    let mut context = meter_io::connect(config)
        .map_err(|message| connection_failure(Some(session_id), message))?;
    storage::create_session(&connection, session_id, started_at, config)
        .map_err(|message| runtime_failure(Some(session_id), message))?;

    emit_log(
        app,
        format!(
            "Connected to {}. Logging to {}",
            config.port,
            paths.database.display()
        ),
    );
    let deadline = if config.run_hours > 0.0 {
        let milliseconds = (config.run_hours * 3_600_000.0).round() as i64;
        let deadline = started_at + ChronoDuration::milliseconds(milliseconds);
        emit_log(
            app,
            format!(
                "Monitoring started; will stop at {}.",
                deadline.format("%Y-%m-%d %H:%M:%S")
            ),
        );
        Some(deadline)
    } else {
        emit_log(app, "Monitoring started; running until stopped.");
        None
    };

    let mut sample_count = 0_u64;
    let mut error_count = 0_u64;
    let mut consecutive_errors = 0_u64;
    let mut batch = Vec::with_capacity(config.commit_every as usize);
    let mut status = "stopped".to_string();
    let mut stop_reason = "Stopped by user".to_string();

    let loop_result = (|| -> Result<(), String> {
        loop {
            let loop_started = Instant::now();
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if deadline.is_some_and(|deadline| Local::now() >= deadline) {
                status = "completed".into();
                stop_reason = "Run duration reached".into();
                break;
            }

            let readings = meter_io::read_basic_targets_until(&mut context, config, || {
                stop.load(Ordering::SeqCst)
            });
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let values = meter_io::readings_to_values(&readings);
            let timestamp = Local::now();
            let message;

            if values.any_value() {
                batch.push(ReadingRow::new(session_id, timestamp, values.clone()));
                sample_count += 1;
                message = status_message(&values);
                if consecutive_errors > 0 {
                    emit_log(
                        app,
                        format!("Communication restored after {consecutive_errors} read error(s)."),
                    );
                }
                consecutive_errors = 0;
            } else {
                error_count += 1;
                consecutive_errors += 1;
                message = readings
                    .first()
                    .map(|reading| reading.message.clone())
                    .unwrap_or_else(|| "Read error".into());
                if should_log_consecutive_error(consecutive_errors) {
                    if consecutive_errors == 1 {
                        emit_log(app, format!("Read error: {message}"));
                    } else {
                        emit_log(
                            app,
                            format!(
                                "Still not receiving data: {consecutive_errors} consecutive read errors. Last error: {message}"
                            ),
                        );
                    }
                }
            }

            if batch.len() >= config.commit_every as usize {
                storage::flush_readings(&mut connection, &mut batch)?;
            }

            let elapsed = ((timestamp - started_at).num_milliseconds() as f64 / 1000.0).max(1.0);
            let _ = app.emit(
                "live-update",
                LiveUpdate {
                    session_id: session_id.into(),
                    timestamp_ms: timestamp.timestamp_millis(),
                    values,
                    sample_count,
                    error_count,
                    live_hz: sample_count as f64 / elapsed,
                    message,
                },
            );

            let interval = config.sample_interval_secs();
            if interval > 0.0 {
                let remaining =
                    Duration::from_secs_f64(interval).saturating_sub(loop_started.elapsed());
                interruptible_sleep(remaining, stop);
            }
        }
        storage::flush_readings(&mut connection, &mut batch)?;
        Ok(())
    })();

    let ended_at = Local::now();
    if let Err(message) = loop_result {
        let _ = storage::flush_readings(&mut connection, &mut batch);
        let _ = storage::finalize_session(
            &connection,
            session_id,
            ended_at,
            "error",
            "Monitoring failed",
            sample_count,
            error_count,
        );
        return Err(runtime_failure(Some(session_id), message));
    }

    storage::finalize_session(
        &connection,
        session_id,
        ended_at,
        &status,
        &stop_reason,
        sample_count,
        error_count,
    )
    .map_err(|message| runtime_failure(Some(session_id), message))?;
    emit_log(
        app,
        format!(
            "Run finished: {sample_count} samples, {error_count} errors, {}.",
            stop_reason.to_ascii_lowercase()
        ),
    );

    Ok(SessionSummary {
        session_id: session_id.into(),
        started_at: started_at.to_rfc3339(),
        ended_at: ended_at.to_rfc3339(),
        sample_count,
        error_count,
        stop_reason,
        status,
        database_path: paths.database.to_string_lossy().into_owned(),
        report_path: None,
    })
}

fn emit_log(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit(
        "monitor-log",
        MonitorLog {
            timestamp_ms: Local::now().timestamp_millis(),
            message: message.into(),
        },
    );
}

fn interruptible_sleep(duration: Duration, stop: &AtomicBool) {
    let started = Instant::now();
    while started.elapsed() < duration && !stop.load(Ordering::SeqCst) {
        let remaining = duration.saturating_sub(started.elapsed());
        thread::sleep(remaining.min(Duration::from_millis(50)));
    }
}

fn status_message(values: &MeterValues) -> String {
    let mut parts = Vec::new();
    if let Some(value) = values.frequency_hz {
        parts.push(format!("{value:.3} Hz"));
    }
    if let Some(value) = values.phase_voltage_v1 {
        parts.push(format!("{value:.3} V1"));
    }
    if let Some(value) = values.current_i1 {
        parts.push(format!("{value:.3} A1"));
    }
    if parts.is_empty() {
        "Partial read".into()
    } else {
        parts.join("  ")
    }
}

fn should_log_consecutive_error(count: u64) -> bool {
    count == 1 || count == 5 || count == 10 || count % 25 == 0
}

fn session_id(started_at: DateTime<Local>) -> String {
    format!(
        "run_{}_{:06}",
        started_at.format("%Y%m%d_%H%M%S"),
        started_at.timestamp_subsec_micros()
    )
}

fn connection_failure(session_id: Option<&str>, message: String) -> MonitorFailure {
    MonitorFailure {
        kind: "connection".into(),
        message,
        session_id: session_id.map(str::to_string),
    }
}

fn runtime_failure(session_id: Option<&str>, message: String) -> MonitorFailure {
    MonitorFailure {
        kind: "runtime".into(),
        message,
        session_id: session_id.map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::{session_id, should_log_consecutive_error, status_message};
    use crate::domain::meter::MeterValues;
    use chrono::Local;

    #[test]
    fn error_log_thresholds_match_legacy() {
        let logged: Vec<u64> = (1..=50)
            .filter(|count| should_log_consecutive_error(*count))
            .collect();
        assert_eq!(logged, vec![1, 5, 10, 25, 50]);
    }

    #[test]
    fn session_ids_have_legacy_prefix() {
        assert!(session_id(Local::now()).starts_with("run_"));
    }

    #[test]
    fn status_message_uses_available_primary_metrics() {
        let values = MeterValues {
            frequency_hz: Some(60.0),
            current_i1: Some(3.5),
            ..MeterValues::default()
        };
        assert_eq!(status_message(&values), "60.000 Hz  3.500 A1");
    }
}
