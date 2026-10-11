import {
  MAX_OBSERVATION_AGE_MS,
  type Coordinates,
} from "./types";

import { findNearbyObservations } from "./spatial";

const DEFAULT_MAX_DISTANCE_METERS = 4_500;
const DEFAULT_MIN_OBSERVATIONS = 2;
const DEFAULT_IDW_POWER = 2;
const EXACT_MATCH_DISTANCE_METERS = 1;

export type AQIInterpolationResult = {
  status: "estimated" | "unavailable";

  method:
    | "exact_observation"
    | "inverse_distance_weighting"
    | "none";

  estimatedAqi: number | null;

  indexCode: string;

  observationCount: number;
  nearestObservationDistanceMeters: number | null;

  coverage: "good" | "limited" | "insufficient";

  message: string;
};

export type InterpolationOptions = {
  indexCode?: string;
  maxDistanceMeters?: number;
  maxAgeMs?: number;
  minObservations?: number;
  power?: number;
};

/**
 * Estimates AQI at a coordinate using nearby observations
 * from the same AQI index.
 *
 * An estimate is not a direct measurement. When coverage
 * is insufficient, the function returns unavailable.
 */
export async function estimateAQI(
  coordinates: Coordinates,
  options: InterpolationOptions = {}
): Promise<AQIInterpolationResult> {
  const indexCode = options.indexCode ?? "ind_cpcb";

  const maxDistanceMeters =
    options.maxDistanceMeters ??
    DEFAULT_MAX_DISTANCE_METERS;

  const maxAgeMs =
    options.maxAgeMs ?? MAX_OBSERVATION_AGE_MS;

  const minObservations =
    options.minObservations ??
    DEFAULT_MIN_OBSERVATIONS;

  const power = options.power ?? DEFAULT_IDW_POWER;

  if (
    !Number.isFinite(maxDistanceMeters) ||
    maxDistanceMeters <= 0
  ) {
    throw new Error(
      "maxDistanceMeters must be greater than zero."
    );
  }

  if (
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0
  ) {
    throw new Error(
      "maxAgeMs must be greater than zero."
    );
  }

  if (
    !Number.isInteger(minObservations) ||
    minObservations < 1
  ) {
    throw new Error(
      "minObservations must be a positive integer."
    );
  }

  if (!Number.isFinite(power) || power <= 0) {
    throw new Error(
      "IDW power must be greater than zero."
    );
  }

  const nearby = await findNearbyObservations(
    coordinates,
    {
      maxDistanceMeters,
      maxAgeMs,
      minObservations: 1,
    }
  );

  // Never combine different AQI index systems.
  const observations = nearby.observations.filter(
    ({ observation }) =>
      observation.indexCode === indexCode
  );

  const nearestDistance =
    observations.length > 0
      ? observations[0].distanceMeters
      : null;

  const unavailable = (
    message: string
  ): AQIInterpolationResult => ({
    status: "unavailable",
    method: "none",
    estimatedAqi: null,
    indexCode,
    observationCount: observations.length,
    nearestObservationDistanceMeters: nearestDistance,
    coverage: "insufficient",
    message,
  });

  if (observations.length === 0) {
    return unavailable(
      `No fresh observations for AQI index ${indexCode} were found within ${maxDistanceMeters} metres.`
    );
  }

  // If the query coordinate exactly matches a provider
  // observation, use that value rather than interpolating.
  const exactObservation = observations.find(
    ({ distanceMeters }) =>
      distanceMeters <= EXACT_MATCH_DISTANCE_METERS
  );

  if (exactObservation) {
    return {
      status: "estimated",
      method: "exact_observation",
      estimatedAqi: exactObservation.observation.aqi,
      indexCode,
      observationCount: 1,
      nearestObservationDistanceMeters:
        exactObservation.distanceMeters,
      coverage: "good",
      message:
        "AQI returned from an observation at the queried coordinate; this is not a direct sensor measurement.",
    };
  }

  if (observations.length < minObservations) {
    return unavailable(
      `At least ${minObservations} fresh, nearby observations with index ${indexCode} are required.`
    );
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const item of observations) {
    const distanceMeters = item.distanceMeters;

    if (
      !Number.isFinite(distanceMeters) ||
      distanceMeters <= 0
    ) {
      continue;
    }

    const weight =
      1 / Math.pow(distanceMeters, power);

    weightedSum +=
      item.observation.aqi * weight;

    totalWeight += weight;
  }

  if (
    totalWeight <= 0 ||
    !Number.isFinite(weightedSum) ||
    !Number.isFinite(totalWeight)
  ) {
    return unavailable(
      "A reliable interpolation could not be calculated."
    );
  }

  const estimatedAqi = Math.round(
    weightedSum / totalWeight
  );

  if (!Number.isFinite(estimatedAqi)) {
    return unavailable(
      "The calculated AQI estimate was invalid."
    );
  }

  const nearestDistanceMeters =
    nearestDistance as number;

  const goodCoverage =
    observations.length >= 3 &&
    nearestDistanceMeters <= 2_000;

  return {
    status: "estimated",
    method: "inverse_distance_weighting",
    estimatedAqi,
    indexCode,
    observationCount: observations.length,
    nearestObservationDistanceMeters:
      nearestDistanceMeters,
    coverage: goodCoverage ? "good" : "limited",
    message: goodCoverage
      ? "Estimated from multiple fresh nearby observations."
      : "Estimated from nearby observations, but spatial coverage is limited.",
  };
}