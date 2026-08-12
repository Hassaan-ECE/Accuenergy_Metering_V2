use serde::Serialize;

use crate::{
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
    })
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
}
