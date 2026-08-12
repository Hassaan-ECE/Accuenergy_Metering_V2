use std::{fmt::Write as _, fs, path::PathBuf};

use chrono::Local;

use crate::{
    domain::{config::AppConfig, meter::ACUVIM_BASIC_TARGETS},
    paths::AppPaths,
    storage::{self, ReadingRow},
};

const DEVICE_MANUFACTURER: &str = "Accuenergy";
const DEVICE_MODEL: &str = "Acuvim IIW-M-mV-P2V3";
const DEVICE_PROTOCOL: &str = "Modbus RTU over RS485";

struct MetricStats {
    count: usize,
    mean: f64,
    min: f64,
    max: f64,
    std_dev: f64,
}

pub fn generate(paths: &AppPaths, session_id: &str) -> Result<PathBuf, String> {
    let session =
        storage::require_finalized_session(&paths.database, session_id, "generating a report")?;
    let readings = storage::load_readings(&paths.database, session_id)?;
    if readings.is_empty() {
        return Err("Not enough samples to generate a report.".into());
    }

    let generated_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let latest_cards = latest_values_html(readings.last().expect("readings are not empty"));
    let stats_rows = stats_rows_html(&readings);
    let total_reads = (session.sample_count + session.error_count).max(1);
    let error_rate = session.error_count as f64 / total_reads as f64 * 100.0;
    let voltage_chart = chart_svg(
        &readings,
        &[
            "phase_voltage_v1",
            "phase_voltage_v2",
            "phase_voltage_v3",
            "line_voltage_v12",
        ],
        "Voltage Trend",
    );
    let current_chart = chart_svg(
        &readings,
        &["current_i1", "current_i2", "current_i3"],
        "Current Trend",
    );
    let power_chart = chart_svg(
        &readings,
        &["frequency_hz", "active_power_p1", "power_factor_pf1"],
        "Frequency, Power, and Power Factor",
    );

    let report_html = format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Accuenergy Meter Report - {session_id}</title>
  <style>
    :root {{ color-scheme: light; --ink:#142033; --muted:#66758a; --line:#dbe3ec; --panel:#fff; --soft:#f4f7fb; --accent:#2563eb; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:#edf2f7; color:var(--ink); font-family:"Segoe UI",Arial,sans-serif; }}
    main {{ max-width:1180px; margin:0 auto; padding:28px; }}
    header,section {{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:22px; margin-bottom:18px; box-shadow:0 5px 18px rgba(15,23,42,.05); }}
    h1,h2 {{ margin:0 0 10px; }}
    h1 {{ font-size:30px; }}
    h2 {{ font-size:20px; }}
    .sub {{ color:var(--muted); line-height:1.6; }}
    .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(175px,1fr)); gap:10px; margin-top:16px; }}
    .metric {{ background:var(--soft); border:1px solid var(--line); border-radius:10px; padding:12px; min-width:0; }}
    .metric-label {{ color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }}
    .metric-value {{ font-size:23px; font-weight:700; margin-top:5px; overflow-wrap:anywhere; }}
    .metric-value span {{ color:var(--muted); font-size:13px; margin-left:4px; font-weight:600; }}
    table {{ border-collapse:collapse; width:100%; margin-top:12px; font-variant-numeric:tabular-nums; }}
    th,td {{ border-bottom:1px solid var(--line); padding:9px 10px; text-align:left; }}
    th {{ color:var(--muted); font-size:11px; text-transform:uppercase; }}
    .chart {{ overflow-x:auto; margin-top:14px; border:1px solid var(--line); border-radius:12px; background:#fff; }}
    svg {{ display:block; width:100%; min-width:760px; height:auto; }}
    code {{ color:#334155; }}
    @media print {{ body {{ background:#fff; }} main {{ max-width:none; padding:0; }} header,section {{ box-shadow:none; break-inside:avoid; }} }}
  </style>
</head>
<body>
<main>
  <header>
    <h1>Accuenergy Meter Report</h1>
    <div class="sub">{manufacturer} {model} · {protocol}</div>
    <div class="sub">Session <code>{session_id}</code> · generated {generated_at}</div>
    <div class="grid">
      <div class="metric"><div class="metric-label">Started</div><div class="metric-value">{started}</div></div>
      <div class="metric"><div class="metric-label">Ended</div><div class="metric-value">{ended}</div></div>
      <div class="metric"><div class="metric-label">Status</div><div class="metric-value">{status}</div></div>
      <div class="metric"><div class="metric-label">Samples</div><div class="metric-value">{sample_count}</div></div>
      <div class="metric"><div class="metric-label">Read Errors</div><div class="metric-value">{error_count}<span>{error_rate:.2}%</span></div></div>
    </div>
    <p class="sub">{config_summary}</p>
  </header>
  <section>
    <h2>Latest Values</h2>
    <div class="grid">{latest_cards}</div>
  </section>
  <section>
    <h2>Summary Statistics</h2>
    <table>
      <thead><tr><th>Metric</th><th>Unit</th><th>n</th><th>Mean</th><th>Min</th><th>Max</th><th>Std Dev</th></tr></thead>
      <tbody>{stats_rows}</tbody>
    </table>
  </section>
  <section>
    <h2>Trends</h2>
    <p class="sub">Each metric uses its own vertical range so low-amplitude signals remain visible.</p>
    <div class="chart">{voltage_chart}</div>
    <div class="chart">{current_chart}</div>
    <div class="chart">{power_chart}</div>
  </section>
</main>
</body>
</html>"#,
        session_id = html_escape(session_id),
        manufacturer = html_escape(DEVICE_MANUFACTURER),
        model = html_escape(DEVICE_MODEL),
        protocol = html_escape(DEVICE_PROTOCOL),
        generated_at = html_escape(&generated_at),
        started = html_escape(&session.started_at),
        ended = html_escape(session.ended_at.as_deref().unwrap_or("")),
        status = html_escape(session.stop_reason.as_deref().unwrap_or(&session.status)),
        sample_count = session.sample_count,
        error_count = session.error_count,
        error_rate = error_rate,
        config_summary = html_escape(&config_summary(&session.config)),
        latest_cards = latest_cards,
        stats_rows = stats_rows,
        voltage_chart = voltage_chart,
        current_chart = current_chart,
        power_chart = power_chart,
    )
    .replace("\\\"", "\"");

    fs::create_dir_all(&paths.reports)
        .map_err(|error| format!("Could not create report directory: {error}"))?;
    let output = paths
        .reports
        .join(format!("accuenergy_report_{session_id}.html"));
    fs::write(&output, report_html)
        .map_err(|error| format!("Could not write HTML report: {error}"))?;
    storage::update_report_path(&paths.database, session_id, &output)?;
    Ok(output)
}

pub fn export_csv(paths: &AppPaths, session_id: &str) -> Result<PathBuf, String> {
    let session = storage::require_finalized_session(&paths.database, session_id, "exporting CSV")?;
    let readings = storage::load_readings(&paths.database, session_id)?;
    if readings.is_empty() {
        return Err("This session has no readings to export.".into());
    }
    fs::create_dir_all(&paths.exports)
        .map_err(|error| format!("Could not create export directory: {error}"))?;
    let output = paths
        .exports
        .join(format!("accuenergy_readings_{session_id}.csv"));
    let mut writer = csv::Writer::from_path(&output)
        .map_err(|error| format!("Could not create CSV export: {error}"))?;
    let config_json = serde_json::to_string(&session.config)
        .map_err(|error| format!("Could not serialize session settings for CSV: {error}"))?;
    writer
        .write_record([
            "session_id",
            "session_started_at",
            "session_ended_at",
            "session_status",
            "session_stop_reason",
            "session_sample_count",
            "session_error_count",
            "config_json",
            "ts_unix",
            "ts_iso",
            "frequency_hz",
            "phase_voltage_v1",
            "phase_voltage_v2",
            "phase_voltage_v3",
            "line_voltage_v12",
            "current_i1",
            "current_i2",
            "current_i3",
            "active_power_p1",
            "power_factor_pf1",
        ])
        .map_err(|error| format!("Could not write CSV header: {error}"))?;
    for row in readings {
        writer
            .write_record([
                row.session_id,
                session.started_at.clone(),
                session.ended_at.clone().unwrap_or_default(),
                session.status.clone(),
                session.stop_reason.clone().unwrap_or_default(),
                session.sample_count.to_string(),
                session.error_count.to_string(),
                config_json.clone(),
                format_float(row.ts_unix),
                row.ts_iso,
                optional_csv(row.values.frequency_hz),
                optional_csv(row.values.phase_voltage_v1),
                optional_csv(row.values.phase_voltage_v2),
                optional_csv(row.values.phase_voltage_v3),
                optional_csv(row.values.line_voltage_v12),
                optional_csv(row.values.current_i1),
                optional_csv(row.values.current_i2),
                optional_csv(row.values.current_i3),
                optional_csv(row.values.active_power_p1),
                optional_csv(row.values.power_factor_pf1),
            ])
            .map_err(|error| format!("Could not write CSV row: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("Could not finalize CSV export: {error}"))?;
    Ok(output)
}

fn latest_values_html(reading: &ReadingRow) -> String {
    let mut html = String::new();
    for target in ACUVIM_BASIC_TARGETS {
        let value = reading.values.get(target.key);
        let display = value.map(format_float).unwrap_or_else(|| "n/a".into());
        let unit = if target.unit.is_empty() {
            String::new()
        } else {
            format!("<span>{}</span>", html_escape(target.unit))
        };
        let _ = write!(
            html,
            "<div class=\"metric\"><div class=\"metric-label\">{}</div><div class=\"metric-value\">{}{}</div></div>",
            html_escape(target.label),
            html_escape(&display),
            unit
        );
    }
    html
}

fn stats_rows_html(readings: &[ReadingRow]) -> String {
    let mut html = String::new();
    for target in ACUVIM_BASIC_TARGETS {
        let values = readings
            .iter()
            .filter_map(|reading| reading.values.get(target.key))
            .collect::<Vec<_>>();
        let stats = metric_stats(&values);
        let _ = write!(
            html,
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
            html_escape(target.label),
            html_escape(target.unit),
            stats.count,
            format_float(stats.mean),
            format_float(stats.min),
            format_float(stats.max),
            format_float(stats.std_dev),
        );
    }
    html
}

fn metric_stats(values: &[f64]) -> MetricStats {
    if values.is_empty() {
        return MetricStats {
            count: 0,
            mean: 0.0,
            min: 0.0,
            max: 0.0,
            std_dev: 0.0,
        };
    }
    let count = values.len();
    let sum: f64 = values.iter().sum();
    let mean = sum / count as f64;
    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let std_dev = if count > 1 {
        let variance = values
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f64>()
            / (count - 1) as f64;
        variance.sqrt()
    } else {
        0.0
    };
    MetricStats {
        count,
        mean,
        min,
        max,
        std_dev,
    }
}

fn chart_svg(readings: &[ReadingRow], keys: &[&str], title: &str) -> String {
    let width = 1120.0;
    let left = 155.0;
    let right = 24.0;
    let top = 48.0;
    let row_height = 112.0;
    let bottom = 42.0;
    let height = top + row_height * keys.len() as f64 + bottom;
    let plot_width = width - left - right;
    let indices = sampled_indices(readings.len(), 1200);
    let colors = ["#2563eb", "#0f9f6e", "#d97706", "#9333ea"];
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {width:.0} {height:.0}\" role=\"img\" aria-label=\"{}\"><rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/><text x=\"24\" y=\"30\" font-size=\"18\" font-weight=\"700\" fill=\"#142033\">{}</text>",
        html_escape(title),
        html_escape(title)
    );

    for (row_index, key) in keys.iter().enumerate() {
        let target = ACUVIM_BASIC_TARGETS
            .iter()
            .find(|target| target.key == *key);
        let Some(target) = target else { continue };
        let y_top = top + row_index as f64 * row_height;
        let y_bottom = y_top + 78.0;
        let values = indices
            .iter()
            .filter_map(|index| readings[*index].values.get(key))
            .collect::<Vec<_>>();
        let min = values.iter().copied().fold(f64::INFINITY, f64::min);
        let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let range = if values.is_empty() {
            1.0
        } else {
            (max - min).abs().max(max.abs().max(1.0) * 0.01)
        };
        let low = if values.is_empty() {
            0.0
        } else {
            min - range * 0.08
        };
        let high = if values.is_empty() {
            1.0
        } else {
            max + range * 0.08
        };

        let _ = write!(
            svg,
            "<rect x=\"{left}\" y=\"{y_top}\" width=\"{plot_width}\" height=\"78\" rx=\"6\" fill=\"#f8fafc\" stroke=\"#dbe3ec\"/>"
        );
        for grid_index in 1..4 {
            let x = left + plot_width * grid_index as f64 / 4.0;
            let _ = write!(
                svg,
                "<line x1=\"{x:.2}\" y1=\"{y_top}\" x2=\"{x:.2}\" y2=\"{y_bottom}\" stroke=\"#e7edf4\"/>"
            );
        }
        let label = if target.unit.is_empty() {
            target.label.to_string()
        } else {
            format!("{} ({})", target.label, target.unit)
        };
        let _ = write!(
            svg,
            "<text x=\"24\" y=\"{:.2}\" font-size=\"13\" font-weight=\"700\" fill=\"#334155\">{}</text><text x=\"24\" y=\"{:.2}\" font-size=\"11\" fill=\"#64748b\">{} to {}</text>",
            y_top + 29.0,
            html_escape(&label),
            y_top + 49.0,
            format_float(low),
            format_float(high),
        );

        if !values.is_empty() {
            let mut segment = String::new();
            for (point_index, reading_index) in indices.iter().enumerate() {
                if let Some(value) = readings[*reading_index].values.get(key) {
                    let x = if indices.len() <= 1 {
                        left
                    } else {
                        left + plot_width * point_index as f64 / (indices.len() - 1) as f64
                    };
                    let y = y_bottom - (value - low) / (high - low) * 78.0;
                    let _ = write!(segment, "{x:.2},{y:.2} ");
                } else if !segment.is_empty() {
                    let _ = write!(
                        svg,
                        "<polyline fill=\"none\" stroke=\"{}\" stroke-width=\"2\" points=\"{}\"/>",
                        colors[row_index % colors.len()],
                        segment.trim()
                    );
                    segment.clear();
                }
            }
            if !segment.is_empty() {
                let _ = write!(
                    svg,
                    "<polyline fill=\"none\" stroke=\"{}\" stroke-width=\"2\" points=\"{}\"/>",
                    colors[row_index % colors.len()],
                    segment.trim()
                );
            }
        } else {
            let _ = write!(
                svg,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#94a3b8\">No data</text>",
                left + plot_width / 2.0,
                y_top + 43.0
            );
        }
    }

    if let (Some(first), Some(last)) = (readings.first(), readings.last()) {
        let _ = write!(
            svg,
            "<text x=\"{left}\" y=\"{}\" font-size=\"11\" fill=\"#64748b\">{}</text><text x=\"{}\" y=\"{}\" text-anchor=\"end\" font-size=\"11\" fill=\"#64748b\">{}</text>",
            height - 15.0,
            html_escape(&first.ts_iso),
            width - right,
            height - 15.0,
            html_escape(&last.ts_iso),
        );
    }
    svg.push_str("</svg>");
    svg
}

fn sampled_indices(length: usize, maximum: usize) -> Vec<usize> {
    if length <= maximum {
        return (0..length).collect();
    }
    (0..maximum)
        .map(|index| index * (length - 1) / (maximum - 1))
        .collect()
}

fn config_summary(config: &AppConfig) -> String {
    let sample = if config.sample_hz == 0.0 {
        "max speed".into()
    } else {
        format!("{} Hz", format_float(config.sample_hz))
    };
    let run = if config.run_hours == 0.0 {
        "until stopped".into()
    } else {
        format!("{} h", format_float(config.run_hours))
    };
    format!(
        "{} @ {} baud · Device {} · Parity {} · Stop {} · {} · Run {} · Commit {} · Timeout {} s · Retries {}",
        config.port,
        config.baudrate,
        config.device_id,
        config.parity,
        config.stop_bits,
        sample,
        run,
        config.commit_every,
        format_float(config.timeout_seconds),
        config.retries
    )
}

fn optional_csv(value: Option<f64>) -> String {
    value.map(format_float).unwrap_or_default()
}

fn format_float(value: f64) -> String {
    format!("{value:.6}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use chrono::Local;
    use tempfile::tempdir;

    use super::*;
    use crate::{domain::meter::MeterValues, storage::ReadingRow};

    #[test]
    fn finalized_session_generates_self_contained_report_and_csv() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();
        let mut connection = storage::connect(&paths.database).unwrap();
        let started = Local::now();
        storage::create_session(&connection, "run_report", started, &AppConfig::default()).unwrap();
        let mut batch = vec![
            ReadingRow::new(
                "run_report",
                started,
                MeterValues {
                    frequency_hz: Some(60.0),
                    phase_voltage_v1: Some(120.0),
                    current_i1: Some(4.0),
                    active_power_p1: Some(480.0),
                    power_factor_pf1: Some(0.98),
                    ..MeterValues::default()
                },
            ),
            ReadingRow::new(
                "run_report",
                Local::now(),
                MeterValues {
                    frequency_hz: Some(60.1),
                    phase_voltage_v1: Some(121.0),
                    current_i1: Some(4.1),
                    active_power_p1: Some(496.1),
                    power_factor_pf1: Some(0.97),
                    ..MeterValues::default()
                },
            ),
        ];
        storage::flush_readings(&mut connection, &mut batch).unwrap();
        storage::finalize_session(
            &connection,
            "run_report",
            Local::now(),
            "completed",
            "Run duration reached",
            2,
            0,
        )
        .unwrap();
        drop(connection);

        let report = generate(&paths, "run_report").unwrap();
        let html = fs::read_to_string(report).unwrap();
        assert!(html.contains("Summary Statistics"));
        assert!(html.contains("<svg"));
        assert!(!html.contains("<script"));
        assert!(!html.contains("<link"));
        assert!(!html.contains("src=\"http"));

        let csv = export_csv(&paths, "run_report").unwrap();
        let csv_text = fs::read_to_string(csv).unwrap();
        assert!(csv_text.contains("frequency_hz"));
        assert!(csv_text.contains("60.1"));
        assert!(csv_text.contains("session_started_at"));
        assert!(csv_text.contains("config_json"));
        assert!(csv_text.contains("\"\"deviceId\"\":1"));
    }

    #[test]
    fn running_session_with_flushed_readings_rejects_report_and_csv() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();
        let mut connection = storage::connect(&paths.database).unwrap();
        let started = Local::now();
        storage::create_session(
            &connection,
            "run_in_progress",
            started,
            &AppConfig::default(),
        )
        .unwrap();
        let mut batch = vec![ReadingRow::new(
            "run_in_progress",
            started,
            MeterValues {
                frequency_hz: Some(60.0),
                ..MeterValues::default()
            },
        )];
        storage::flush_readings(&mut connection, &mut batch).unwrap();
        drop(connection);

        let report_error = generate(&paths, "run_in_progress").unwrap_err();
        assert!(report_error.contains("not finalized"));
        assert!(report_error.contains("session to finish"));
        assert!(report_error.contains("generating a report"));
        assert!(!paths
            .reports
            .join("accuenergy_report_run_in_progress.html")
            .exists());

        let csv_error = export_csv(&paths, "run_in_progress").unwrap_err();
        assert!(csv_error.contains("not finalized"));
        assert!(csv_error.contains("session to finish"));
        assert!(csv_error.contains("exporting CSV"));
        assert!(!paths
            .exports
            .join("accuenergy_readings_run_in_progress.csv")
            .exists());
    }

    #[test]
    fn missing_and_finalized_empty_session_errors_are_preserved() {
        let temp = tempdir().unwrap();
        let paths = AppPaths::from_root(temp.path().join("app-data")).unwrap();

        assert_eq!(
            generate(&paths, "run_missing").unwrap_err(),
            "Session not found: run_missing"
        );
        assert_eq!(
            export_csv(&paths, "run_missing").unwrap_err(),
            "Session not found: run_missing"
        );

        let connection = storage::connect(&paths.database).unwrap();
        let started = Local::now();
        storage::create_session(&connection, "run_empty", started, &AppConfig::default()).unwrap();
        storage::finalize_session(
            &connection,
            "run_empty",
            Local::now(),
            "stopped",
            "Stopped by user",
            0,
            0,
        )
        .unwrap();
        drop(connection);

        assert_eq!(
            generate(&paths, "run_empty").unwrap_err(),
            "Not enough samples to generate a report."
        );
        assert_eq!(
            export_csv(&paths, "run_empty").unwrap_err(),
            "This session has no readings to export."
        );
    }

    #[test]
    fn computes_sample_standard_deviation() {
        let stats = metric_stats(&[1.0, 2.0, 3.0]);
        assert_eq!(stats.count, 3);
        assert!((stats.mean - 2.0).abs() < f64::EPSILON);
        assert!((stats.std_dev - 1.0).abs() < f64::EPSILON);
    }
}
