import type { Coordinates } from "./types";

/**
 * Calculates the great-circle distance between two
 * coordinates using the Haversine formula.
 *
 * Returns distance in metres.
 */
export function distanceBetween(
  first: Coordinates,
  second: Coordinates
): number {
  const earthRadiusMeters = 6_371_000;

  const toRadians = (degrees: number) =>
    (degrees * Math.PI) / 180;

  const latitude1 = toRadians(first.latitude);
  const latitude2 = toRadians(second.latitude);

  const deltaLatitude = toRadians(
    second.latitude - first.latitude
  );

  const deltaLongitude = toRadians(
    second.longitude - first.longitude
  );

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) ** 2;

  const boundedA = Math.min(1, Math.max(0, a));

  return (
    2 *
    earthRadiusMeters *
    Math.atan2(
      Math.sqrt(boundedA),
      Math.sqrt(1 - boundedA)
    )
  );
}