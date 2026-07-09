export type SensorPayload = Record<string, unknown>;

export type NormalizedVitals = {
  patientId?: string;
  deviceId?: string;
  timestamp?: string;
  heartRate?: number;
  spo2?: number;
  temperature?: number;
  glucose?: number;
  systolic?: number;
  diastolic?: number;
};

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function read(payload: SensorPayload, names: string[]) {
  for (const name of names) {
    if (payload[name] !== undefined && payload[name] !== null) return payload[name];
  }
}

export function latestPayload(value: unknown): SensorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = value as SensorPayload;
  const directKeys = ["heart_rate", "heartRate", "spo2", "SpO2", "temperature", "sensor_data", "vitals"];
  if (directKeys.some((key) => key in payload)) return payload;

  const children = Object.entries(payload).filter((entry) => entry[1] && typeof entry[1] === "object");
  if (!children.length) return payload;
  children.sort(([keyA, valueA], [keyB, valueB]) => {
    const a = valueA as SensorPayload;
    const b = valueB as SensorPayload;
    return String(read(a, ["recorded_at", "timestamp"]) ?? keyA).localeCompare(
      String(read(b, ["recorded_at", "timestamp"]) ?? keyB),
    );
  });
  return children.at(-1)?.[1] as SensorPayload;
}

export function normalizeVitals(input: SensorPayload): NormalizedVitals {
  const payload: SensorPayload = { ...input };
  for (const key of ["sensor_data", "sensors", "vitals", "data", "readings", "blood_pressure"]) {
    const nested = payload[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) Object.assign(payload, nested);
  }

  return {
    patientId: String(read(payload, ["patient_id", "patientId", "user_id", "userId"]) ?? "") || undefined,
    deviceId: String(read(payload, ["device_id", "deviceId", "device"]) ?? "") || undefined,
    timestamp: String(read(payload, ["recorded_at", "timestamp", "created_at", "time"]) ?? "") || undefined,
    heartRate: asNumber(read(payload, ["heart_rate", "heartRate", "heartrate", "pulse", "bpm"])),
    spo2: asNumber(read(payload, ["spo2", "SpO2", "oxygen_saturation"])),
    temperature: asNumber(read(payload, ["temperature", "temp", "body_temperature"])),
    glucose: asNumber(read(payload, ["glucose", "blood_glucose"])),
    systolic: asNumber(read(payload, ["systolic", "bp_systolic", "blood_pressure_systolic"])),
    diastolic: asNumber(read(payload, ["diastolic", "bp_diastolic", "blood_pressure_diastolic"])),
  };
}

export function assessVitals(vitals: NormalizedVitals) {
  const alerts: string[] = [];
  if (vitals.spo2 !== undefined && vitals.spo2 < 92) alerts.push("Low oxygen saturation");
  if (vitals.heartRate !== undefined && (vitals.heartRate < 50 || vitals.heartRate > 120)) alerts.push("Abnormal heart rate");
  if (vitals.temperature !== undefined && vitals.temperature >= 38) alerts.push("High temperature");
  if (vitals.systolic !== undefined && (vitals.systolic >= 180 || vitals.systolic < 90)) alerts.push("Critical systolic blood pressure");
  if (vitals.glucose !== undefined && (vitals.glucose < 54 || vitals.glucose > 250)) alerts.push("Critical glucose reading");
  return alerts;
}

export const demoPayload: SensorPayload = {
  patient_id: "P001-DEMO",
  device_id: "RPI5-DEMO",
  sensor_data: {
    heart_rate: 78,
    spo2: 98,
    temperature: 36.8,
    glucose: 108,
    blood_pressure: { systolic: 121, diastolic: 79 },
  },
};
