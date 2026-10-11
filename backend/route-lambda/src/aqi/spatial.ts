import {
  MAX_OBSERVATION_AGE_MS,
  isValidAQI,
  isValidCoordinates,
  type AQIObservation,
  type Coordinates,
} from "./types";

import { getNearbyObservations } from "./repository";
import { distanceBetween } from "./distance";

export type NearbyObservation = {
  observation: AQIObservation;
  distanceMeters: number;
};

export type SpatialLookupResult = {
  status: "available" | "insufficient_data";
  queryCoordinates: Coordinates;
  observations: NearbyObservation[];
  candidateCount: number;
  maxDistanceMeters: number;
  freshnessCutoffMs: number;
};

/**
 * Finds observations that are both recent and
 * sufficiently close to a requested coordinate.
 */
export async function findNearbyObservations(
  coordinates: Coordinates,
  options?: {
    maxDistanceMeters?: number;
    maxAgeMs?: number;
    minObservations?: number;
  }
): Promise<SpatialLookupResult> {
  if (!isValidCoordinates(coordinates)) {
    throw new Error("Invalid query coordinates.");
  }

  const maxDistanceMeters =
    options?.maxDistanceMeters ?? 4_500;

  const maxAgeMs =
    options?.maxAgeMs ?? MAX_OBSERVATION_AGE_MS;

  const minObservations =
    options?.minObservations ?? 1;

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

  // This repository query searches the center geohash
  // and its eight neighboring cells.
  const candidates = await getNearbyObservations(
    coordinates
  );

  const now = Date.now();

  const observations: NearbyObservation[] = candidates
    .filter((observation) => {
      if (
        !isValidCoordinates(observation) ||
        !isValidAQI(observation.aqi)
      ) {
        return false;
      }

      const observedAt = Date.parse(
        observation.observedAt
      );

      if (!Number.isFinite(observedAt)) {
        return false;
      }

      const age = now - observedAt;

      return age >= 0 && age <= maxAgeMs;
    })
    .map((observation) => ({
      observation,
      distanceMeters: distanceBetween(
        coordinates,
        observation
      ),
    }))
    .filter(
      (item) =>
        item.distanceMeters <= maxDistanceMeters
    )
    .sort(
      (first, second) =>
        first.distanceMeters - second.distanceMeters
    );

  return {
    status:
      observations.length >= minObservations
        ? "available"
        : "insufficient_data",

    queryCoordinates: coordinates,
    observations,
    candidateCount: candidates.length,
    maxDistanceMeters,
    freshnessCutoffMs: maxAgeMs,
  };
}