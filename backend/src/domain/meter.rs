//! Acuvim IIW basic holding-register map (float32 big-endian pairs).
//! Addresses match the legacy Python `ACUVIM_BASIC_TARGETS`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy)]
pub struct MeterTarget {
    pub key: &'static str,
    pub label: &'static str,
    pub address: u16,
    pub unit: &'static str,
}

/// Holding registers read as IEEE-754 big-endian float (2 registers each).
pub const ACUVIM_BASIC_TARGETS: &[MeterTarget] = &[
    MeterTarget {
        key: "frequency_hz",
        label: "Frequency",
        address: 0x4000,
        unit: "Hz",
    },
    MeterTarget {
        key: "phase_voltage_v1",
        label: "Phase Voltage V1",
        address: 0x4002,
        unit: "V",
    },
    MeterTarget {
        key: "phase_voltage_v2",
        label: "Phase Voltage V2",
        address: 0x4004,
        unit: "V",
    },
    MeterTarget {
        key: "phase_voltage_v3",
        label: "Phase Voltage V3",
        address: 0x4006,
        unit: "V",
    },
    MeterTarget {
        key: "line_voltage_v12",
        label: "Line Voltage V12",
        address: 0x400A,
        unit: "V",
    },
    MeterTarget {
        key: "current_i1",
        label: "Current I1",
        address: 0x4012,
        unit: "A",
    },
    MeterTarget {
        key: "current_i2",
        label: "Current I2",
        address: 0x4014,
        unit: "A",
    },
    MeterTarget {
        key: "current_i3",
        label: "Current I3",
        address: 0x4016,
        unit: "A",
    },
    MeterTarget {
        key: "active_power_p1",
        label: "Active Power P1",
        address: 0x401C,
        unit: "W",
    },
    MeterTarget {
        key: "power_factor_pf1",
        label: "Power Factor PF1",
        address: 0x4034,
        unit: "",
    },
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MeterValues {
    pub frequency_hz: Option<f64>,
    pub phase_voltage_v1: Option<f64>,
    pub phase_voltage_v2: Option<f64>,
    pub phase_voltage_v3: Option<f64>,
    pub line_voltage_v12: Option<f64>,
    pub current_i1: Option<f64>,
    pub current_i2: Option<f64>,
    pub current_i3: Option<f64>,
    pub active_power_p1: Option<f64>,
    pub power_factor_pf1: Option<f64>,
}

/// Decode two 16-bit holding registers as big-endian IEEE-754 float.
pub fn decode_float_be(registers: [u16; 2]) -> f32 {
    let bytes = ((registers[0] as u32) << 16 | registers[1] as u32).to_be_bytes();
    f32::from_be_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::decode_float_be;

    #[test]
    fn decodes_known_float() {
        // 60.0f32 = 0x42700000
        let value = decode_float_be([0x4270, 0x0000]);
        assert!((value - 60.0).abs() < f32::EPSILON);
    }
}
