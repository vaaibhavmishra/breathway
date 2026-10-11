import ngeohash = require("ngeohash");

import {
  GEOHASH_PRECISION,
  type Coordinates,
} from "./types";

export function encodeGeohash(
  coordinates: Coordinates,
  precision = GEOHASH_PRECISION
): string {
  if (
    !Number.isInteger(precision) ||
    precision < 1 ||
    precision > 12
  ) {
    throw new Error("Geohash precision must be between 1 and 12.");
  }

  return ngeohash.encode(
    coordinates.latitude,
    coordinates.longitude,
    precision
  );
}

export function getNearbyGeohashes(
  coordinates: Coordinates,
  precision = GEOHASH_PRECISION
): string[] {
  const center = encodeGeohash(coordinates, precision);
  const neighbors = ngeohash.neighbors(center);

  // Remove duplicates to avoid querying a cell more than once.
  return [...new Set([center, ...neighbors])];
}