import type { Handler } from "aws-lambda";

import {
    GEOHASH_PRECISION,
    isValidAQI,
    isValidCoordinates,
    type Coordinates,
} from "./types";

import { encodeGeohash } from "./geohash";
import { saveObservation } from "./repository";

const GOOGLE_AIR_QUALITY_API_URL =
    "https://airquality.googleapis.com/v1/currentConditions:lookup";

const GOOGLE_AIR_QUALITY_API_KEY =
    process.env.GOOGLE_AIR_QUALITY_API_KEY;

type GoogleAirQualityIndex = {
    code?: string;
    displayName?: string;
    aqi?: number;
    aqiDisplay?: string;
    category?: string;
    dominantPollutant?: string;
};

type GoogleAirQualityResponse = {
    dateTime?: string;
    regionCode?: string;
    indexes?: GoogleAirQualityIndex[];
};

type IngestionEvent = {
    locations?: Array<Coordinates & { locationId?: string }>;
};

type IngestionResult = {
    requested: number;
    saved: number;
    skipped: number;
    failed: number;
    results: Array<{
        locationId: string;
        status: "saved" | "skipped" | "failed";
        aqi?: number;
        geohash?: string;
        reason?: string;
    }>;
};

function getConfiguredLocations(): Array<
    Coordinates & { locationId?: string }
> {
    const rawLocations = process.env.AQI_INGEST_LOCATIONS;

    if (!rawLocations) {
        throw new Error(
            "AQI_INGEST_LOCATIONS is not configured."
        );
    }

    let locations: unknown;

    try {
        locations = JSON.parse(rawLocations);
    } catch {
        throw new Error(
            "AQI_INGEST_LOCATIONS must contain valid JSON."
        );
    }

    if (!Array.isArray(locations) || locations.length === 0) {
        throw new Error(
            "AQI_INGEST_LOCATIONS must be a non-empty array."
        );
    }

    return locations as Array<
        Coordinates & { locationId?: string }
    >;
}

function getLocationId(
    coordinates: Coordinates,
    suppliedId?: string
): string {
    if (suppliedId?.trim()) {
        return suppliedId.trim();
    }

    // Stable identifier for the configured coordinate.
    // This is not a physical monitoring-station ID.
    return [
        "google",
        coordinates.latitude.toFixed(5),
        coordinates.longitude.toFixed(5),
    ].join("-");
}

async function fetchAirQuality(
    coordinates: Coordinates
): Promise<GoogleAirQualityResponse> {
    if (!GOOGLE_AIR_QUALITY_API_KEY) {
        throw new Error(
            "GOOGLE_AIR_QUALITY_API_KEY is not configured."
        );
    }

    const url = new URL(GOOGLE_AIR_QUALITY_API_URL);

    url.searchParams.set(
        "key",
        GOOGLE_AIR_QUALITY_API_KEY
    );

    const response = await fetch(url.toString(), {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
        },

        body: JSON.stringify({
            location: {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
            },

            extraComputations: ["LOCAL_AQI"],
            universalAqi: false,
            languageCode: "en",
        }),

        signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
        // Avoid logging the request URL because it contains
        // the API key.
        console.error(
            "Google Air Quality API returned HTTP",
            response.status
        );

        throw new Error(
            `Air-quality provider returned HTTP ${response.status}.`
        );
    }

    return (await response.json()) as GoogleAirQualityResponse;
}

function selectAQIIndex(
    response: GoogleAirQualityResponse
): GoogleAirQualityIndex | undefined {
    const indexes = response.indexes ?? [];

    return (
        indexes.find((index) => index.code === "ind_cpcb") ??
        indexes.find((index) => index.code !== "uaqi") ??
        indexes[0]
    );
}

async function ingestOneLocation(
    location: Coordinates & { locationId?: string }
): Promise<IngestionResult["results"][number]> {
    const locationId = getLocationId(
        location,
        location.locationId
    );

    if (!isValidCoordinates(location)) {
        return {
            locationId,
            status: "skipped",
            reason: "Invalid latitude or longitude.",
        };
    }

    try {
        const providerResponse = await fetchAirQuality(location);

        const selectedIndex = selectAQIIndex(providerResponse);

        if (
            !selectedIndex ||
            !isValidAQI(selectedIndex.aqi)
        ) {
            return {
                locationId,
                status: "skipped",
                reason: "Provider returned no valid AQI index.",
            };
        }

        if (
            !providerResponse.dateTime ||
            !Number.isFinite(Date.parse(providerResponse.dateTime))
        ) {
            return {
                locationId,
                status: "skipped",
                reason: "Provider returned no valid observation timestamp.",
            };
        }

        const geohash = encodeGeohash(
            location,
            GEOHASH_PRECISION
        );

        await saveObservation({
            latitude: location.latitude,
            longitude: location.longitude,

            locationId,

            aqi: selectedIndex.aqi,

            indexCode: selectedIndex.code,
            indexName: selectedIndex.displayName,
            category: selectedIndex.category,

            dominantPollutant:
                selectedIndex.dominantPollutant,

            source: "google_air_quality",

            observedAt: providerResponse.dateTime,
        });

        return {
            locationId,
            status: "saved",
            aqi: selectedIndex.aqi,
            geohash,
        };
    } catch (error) {
        console.error("AQI ingestion failed for location:", {
            locationId,
            message:
                error instanceof Error
                    ? error.message
                    : "Unknown error",
        });

        return {
            locationId,
            status: "failed",
            reason:
                error instanceof Error
                    ? error.message
                    : "Unknown ingestion error.",
        };
    }
}

export const handler: Handler<
    IngestionEvent,
    IngestionResult
> = async (event) => {
    // EventBridge events can have a different structure
    // from manually supplied test events. We only use
    // event.locations when it is a valid, non-empty array.
    const locations =
        Array.isArray(event?.locations) &&
            event.locations.length > 0
            ? event.locations
            : getConfiguredLocations();

    if (locations.length > 100) {
        throw new Error(
            "A single ingestion invocation is limited to 100 locations."
        );
    }

    const results: IngestionResult["results"] = [];

    // Process sequentially to avoid sending a large burst
    // of requests to the external provider.
    for (const location of locations) {
        results.push(
            await ingestOneLocation(location)
        );
    }

    const summary: IngestionResult = {
        requested: results.length,

        saved: results.filter(
            (result) => result.status === "saved"
        ).length,

        skipped: results.filter(
            (result) => result.status === "skipped"
        ).length,

        failed: results.filter(
            (result) => result.status === "failed"
        ).length,

        results,
    };

    console.log("AQI ingestion summary:", summary);

    return summary;
};