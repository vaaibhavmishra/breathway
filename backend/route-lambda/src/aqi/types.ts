export const GEOHASH_PRECISION = 5;

export const MAX_OBSERVATION_AGE_MS = 60 * 60 * 1000;

export const OBSERVATION_RETENTION_SECONDS = 48 * 60 * 60;

export type Coordinates = {
    latitude: number;
    longitude: number;
};

export type AQIObservation = Coordinates & {
    PK: string;
    SK: string;

    locationId: string;
    geohash: string;

    aqi: number;
    indexCode?: string;
    indexName?: string;
    category?: string;
    dominantPollutant?: string;

    source: string;
    observedAt: string;
    ingestedAt: string;

    /** Unix timestamp in seconds; used by DynamoDB TTL. */
    expiresAt: number;
};

export type AQIObservationInput = Coordinates & {
    locationId: string;
    aqi: number;
    indexCode?: string;
    indexName?: string;
    category?: string;
    dominantPollutant?: string;
    source: string;
    observedAt: string;
};

export function isValidAQI(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
    );
}

export function isValidCoordinates(
    value: Coordinates
): boolean {
    return (
        Number.isFinite(value.latitude) &&
        Number.isFinite(value.longitude) &&
        value.latitude >= -90 &&
        value.latitude <= 90 &&
        value.longitude >= -180 &&
        value.longitude <= 180
    );
}