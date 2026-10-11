import {
    CalculateRoutesCommand,
    GeoRoutesClient,
} from "@aws-sdk/client-geo-routes";
import { scoreRoutes, type ScorableRoute } from "./aqi/route-scoring";

const geoRoutesClient = new GeoRoutesClient({
    region: process.env.AWS_REGION ?? "ap-southeast-2",
});

const GOOGLE_AIR_QUALITY_API_KEY = process.env.GOOGLE_AIR_QUALITY_API_KEY;
const AIR_QUALITY_API_URL =
    "https://airquality.googleapis.com/v1/currentConditions:lookup";
const AIR_QUALITY_SAMPLE_COUNT = 5;
const MAX_ALTERNATIVES = 3;

type Coordinates = [longitude: number, latitude: number];

type RequestBody = {
    origin?: Coordinates;
    destination?: Coordinates;
    travelMode?: string;
    waypoints?: Coordinates[];
    pollutionPreference?: number;
    maxExtraTimePercent?: number;
};

type AirQualityIndex = {
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
    indexes?: AirQualityIndex[];
};

type AirQualitySample = {
    coordinate: Coordinates;
    latitude: number;
    longitude: number;
    status: "available" | "unavailable";
    aqi?: number;
    aqiDisplay?: string;
    category?: string;
    dominantPollutant?: string;
    indexCode?: string;
    indexName?: string;
    observedAt?: string;
    error?: string;
};

type ApiResponse = {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
};

function response(statusCode: number, data: unknown): ApiResponse {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "OPTIONS,POST",
        },
        body: JSON.stringify(data),
    };
}

function isValidCoordinates(value: unknown): value is Coordinates {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const [longitude, latitude] = value;
    return (
        typeof longitude === "number" &&
        typeof latitude === "number" &&
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        longitude >= -180 &&
        longitude <= 180 &&
        latitude >= -90 &&
        latitude <= 90
    );
}

function distanceBetween(first: Coordinates, second: Coordinates): number {
    const earthRadiusMeters = 6_371_000;
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitude1 = toRadians(first[1]);
    const latitude2 = toRadians(second[1]);
    const deltaLatitude = toRadians(second[1] - first[1]);
    const deltaLongitude = toRadians(second[0] - first[0]);
    const a =
        Math.sin(deltaLatitude / 2) ** 2 +
        Math.cos(latitude1) *
        Math.cos(latitude2) *
        Math.sin(deltaLongitude / 2) ** 2;
    return (
        2 *
        earthRadiusMeters *
        Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    );
}

function interpolateCoordinates(
    start: Coordinates,
    end: Coordinates,
    fraction: number
): Coordinates {
    return [
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
    ];
}

function sampleRoute(
    coordinates: Coordinates[],
    sampleCount: number
): Coordinates[] {
    if (coordinates.length === 0) return [];
    if (coordinates.length === 1 || sampleCount <= 1) return [coordinates[0]];

    const cumulativeDistances: number[] = [0];
    for (let index = 1; index < coordinates.length; index++) {
        cumulativeDistances.push(
            cumulativeDistances[index - 1] +
            distanceBetween(coordinates[index - 1], coordinates[index])
        );
    }

    const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];
    if (totalDistance === 0) return [coordinates[0]];

    const samples: Coordinates[] = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const targetDistance =
            (totalDistance * sampleIndex) / (sampleCount - 1);
        let segmentIndex = 1;

        while (
            segmentIndex < cumulativeDistances.length - 1 &&
            cumulativeDistances[segmentIndex] < targetDistance
        ) {
            segmentIndex++;
        }

        const startDistance = cumulativeDistances[segmentIndex - 1];
        const endDistance = cumulativeDistances[segmentIndex];
        const segmentLength = endDistance - startDistance;
        const fraction =
            segmentLength === 0
                ? 0
                : (targetDistance - startDistance) / segmentLength;

        samples.push(
            interpolateCoordinates(
                coordinates[segmentIndex - 1],
                coordinates[segmentIndex],
                fraction
            )
        );
    }
    return samples;
}

async function fetchAirQuality(
    coordinate: Coordinates
): Promise<AirQualitySample> {
    const [longitude, latitude] = coordinate;
    if (!GOOGLE_AIR_QUALITY_API_KEY) {
        return {
            coordinate, longitude, latitude, status: "unavailable",
            error: "Google Air Quality API key is not configured.",
        };
    }

    try {
        const url = new URL(AIR_QUALITY_API_URL);
        url.searchParams.set("key", GOOGLE_AIR_QUALITY_API_KEY);

        const apiResponse = await fetch(url.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                location: { latitude, longitude },
                extraComputations: ["LOCAL_AQI"],
                universalAqi: false,
                languageCode: "en",
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error(
                "Google Air Quality API error:",
                apiResponse.status,
                errorText
            );
            return {
                coordinate, longitude, latitude, status: "unavailable",
                error: `Air-quality provider returned HTTP ${apiResponse.status}.`,
            };
        }

        const data = (await apiResponse.json()) as GoogleAirQualityResponse;
        const indexes = data.indexes ?? [];
        const selectedIndex =
            indexes.find((index) => index.code === "ind_cpcb") ??
            indexes[0];

        if (
            !selectedIndex ||
            typeof selectedIndex.aqi !== "number" ||
            !Number.isFinite(selectedIndex.aqi)
        ) {
            return {
                coordinate, longitude, latitude, status: "unavailable",
                error: "No AQI index was returned for this location.",
            };
        }

        return {
            coordinate, longitude, latitude, status: "available",
            aqi: selectedIndex.aqi,
            aqiDisplay: selectedIndex.aqiDisplay,
            category: selectedIndex.category,
            dominantPollutant: selectedIndex.dominantPollutant,
            indexCode: selectedIndex.code,
            indexName: selectedIndex.displayName,
            observedAt: data.dateTime,
        };
    } catch (error) {
        console.error("Failed to fetch air quality:", error);
        return {
            coordinate, longitude, latitude, status: "unavailable",
            error: error instanceof Error ? error.message : "Unknown air-quality error.",
        };
    }
}

async function getRouteAirQuality(coordinates: Coordinates[]) {
    const sampleCoordinates = sampleRoute(
        coordinates,
        AIR_QUALITY_SAMPLE_COUNT
    );
    const samples = await Promise.all(
        sampleCoordinates.map((coordinate) => fetchAirQuality(coordinate))
    );

    const availableSamples = samples.filter(
        (sample): sample is AirQualitySample & { aqi: number } =>
            sample.status === "available" &&
            typeof sample.aqi === "number" &&
            Number.isFinite(sample.aqi)
    );

    const averageAqi =
        availableSamples.length > 0
            ? Math.round(
                availableSamples.reduce((total, sample) => total + sample.aqi, 0) /
                availableSamples.length
            )
            : null;

    const maxAqi =
        availableSamples.length > 0
            ? Math.max(...availableSamples.map((sample) => sample.aqi))
            : null;

    return {
        status: availableSamples.length > 0 ? "available" : "unavailable",
        indexCode:
            availableSamples.find((sample) => sample.indexCode === "ind_cpcb")
                ?.indexCode ??
            availableSamples[0]?.indexCode ??
            null,
        sampleCount: samples.length,
        availableSampleCount: availableSamples.length,
        averageAqi,
        maxAqi,
        samples,
    };
}

type ProviderLeg = {
    Geometry?: {
        LineString?: number[][];
    };
    PedestrianLegDetails?: {
        Summary?: {
            Overview?: { Distance?: number; Duration?: number };
            TravelOnly?: { Distance?: number; Duration?: number };
        };
    };
    VehicleLegDetails?: {
        Summary?: {
            Overview?: { Distance?: number; Duration?: number };
            TravelOnly?: { Distance?: number; Duration?: number };
        };
    };
    FerryLegDetails?: {
        Summary?: {
            Overview?: { Distance?: number; Duration?: number };
        };
    };
};

type ProviderRoute = {
    Legs?: ProviderLeg[];
    Summary?: {
        Distance?: number;
        Duration?: number;
    };
};

function routeToFeature(
    route: ProviderRoute,
    travelMode: "Car" | "Pedestrian" | "Scooter" = "Car"
) {
    const coordinates: Coordinates[] = (route.Legs ?? []).flatMap((leg) =>
        (leg.Geometry?.LineString ?? []).map(
            (coordinate) => [coordinate[0], coordinate[1]] as Coordinates
        )
    );

    if (coordinates.length < 2) return null;

    // 1. Check top-level Route.Summary
    let distanceMeters = route.Summary?.Distance ?? 0;
    let durationSeconds = route.Summary?.Duration ?? 0;

    // 2. If duration or distance is 0, sum across all legs
    if (distanceMeters <= 0 || durationSeconds <= 0) {
        let legDistSum = 0;
        let legDurSum = 0;

        for (const leg of route.Legs ?? []) {
            const pedSummary =
                leg.PedestrianLegDetails?.Summary?.Overview ??
                leg.PedestrianLegDetails?.Summary?.TravelOnly;
            const vehSummary =
                leg.VehicleLegDetails?.Summary?.Overview ??
                leg.VehicleLegDetails?.Summary?.TravelOnly;
            const ferrySummary = leg.FerryLegDetails?.Summary?.Overview;

            const d =
                pedSummary?.Distance ??
                vehSummary?.Distance ??
                ferrySummary?.Distance ??
                0;
            const t =
                pedSummary?.Duration ??
                vehSummary?.Duration ??
                ferrySummary?.Duration ??
                0;

            legDistSum += d;
            legDurSum += t;
        }

        if (distanceMeters <= 0) distanceMeters = legDistSum;
        if (durationSeconds <= 0) durationSeconds = legDurSum;
    }

    // 3. Fallback: compute distance directly from geometry coordinates if still <= 0
    if (distanceMeters <= 0) {
        let geomDist = 0;
        for (let i = 1; i < coordinates.length; i++) {
            geomDist += distanceBetween(coordinates[i - 1], coordinates[i]);
        }
        distanceMeters = Math.round(geomDist);
    }

    // 4. Fallback: estimate realistic duration if still <= 0 based on travel mode
    if (durationSeconds <= 0 && distanceMeters > 0) {
        // Pedestrian running: ~10 km/h (~2.78 m/s), walking: ~5 km/h (~1.39 m/s)
        // Scooter/cycling: ~20 km/h (~5.56 m/s)
        // Car: ~36 km/h (~10.0 m/s)
        const speedMps =
            travelMode === "Pedestrian"
                ? 2.78
                : travelMode === "Scooter"
                  ? 5.56
                  : 10.0;
        durationSeconds = Math.max(30, Math.round(distanceMeters / speedMps));
    }

    return {
        type: "Feature" as const,
        geometry: {
            type: "LineString" as const,
            coordinates,
        },
        properties: {
            distanceMeters: Math.max(0, Math.round(distanceMeters)),
            durationSeconds: Math.max(1, Math.round(durationSeconds)),
        },
    };
}

export const handler = async (
    event: {
        body?: string | null;
        isBase64Encoded?: boolean;
        requestContext?: { http?: { method?: string } };
    }
): Promise<ApiResponse> => {
    try {
        if (event.requestContext?.http?.method === "OPTIONS") {
            return response(200, { ok: true });
        }
        if (!event.body) {
            return response(400, { error: "Request body is required." });
        }

        let body: RequestBody;
        try {
            const decodedBody = event.isBase64Encoded
                ? Buffer.from(event.body, "base64").toString("utf8")
                : event.body;
            body = JSON.parse(decodedBody) as RequestBody;
        } catch {
            return response(400, { error: "Request body must contain valid JSON." });
        }

        if (
            !isValidCoordinates(body.origin) ||
            !isValidCoordinates(body.destination)
        ) {
            return response(400, {
                error: "Origin and destination must be [longitude, latitude] coordinate pairs.",
            });
        }

        if (
            body.pollutionPreference !== undefined &&
            (
                !Number.isFinite(body.pollutionPreference) ||
                body.pollutionPreference < 0 ||
                body.pollutionPreference > 1
            )
        ) {
            return response(400, {
                error: "pollutionPreference must be between 0 and 1.",
            });
        }

        if (
            body.maxExtraTimePercent !== undefined &&
            (
                !Number.isFinite(body.maxExtraTimePercent) ||
                body.maxExtraTimePercent < 0 ||
                body.maxExtraTimePercent > 100
            )
        ) {
            return response(400, {
                error: "maxExtraTimePercent must be between 0 and 100.",
            });
        }

        const rawMode = (body.travelMode ?? "Car").toLowerCase();
        let travelMode: "Car" | "Pedestrian" | "Scooter" = "Car";
        if (
            rawMode === "pedestrian" ||
            rawMode === "running" ||
            rawMode === "run" ||
            rawMode === "walking" ||
            rawMode === "walk"
        ) {
            travelMode = "Pedestrian";
        } else if (
            rawMode === "bicycle" ||
            rawMode === "cycling" ||
            rawMode === "cycle" ||
            rawMode === "bike" ||
            rawMode === "scooter"
        ) {
            travelMode = "Scooter";
        }

        const waypoints = Array.isArray(body.waypoints)
            ? body.waypoints
                  .filter(isValidCoordinates)
                  .map((coord) => ({ Position: coord, PassThrough: true }))
            : undefined;

        // Ask Amazon Location for genuine alternatives; the provider may return fewer.
        const command = new CalculateRoutesCommand({
            Origin: body.origin,
            Destination: body.destination,
            TravelMode: travelMode,
            ...(waypoints && waypoints.length > 0 ? { Waypoints: waypoints } : {}),
            DepartNow: true,
            ...(travelMode === "Car" ? { Traffic: { Usage: "UseTrafficData" } } : {}),
            LegAdditionalFeatures: ["Summary"],
            LegGeometryFormat: "Simple",
            MaxAlternatives: MAX_ALTERNATIVES,
        });

        const routeResponse = await geoRoutesClient.send(command);
        const providerRoutes = routeResponse.Routes ?? [];
        if (providerRoutes.length === 0) {
            return response(502, {
                error: "Amazon Location did not return a route.",
            });
        }

        const routes = await Promise.all(
            providerRoutes.map(async (providerRoute, index) => {
                const route = routeToFeature(providerRoute, travelMode);
                if (!route) return null;

                const airQuality = await getRouteAirQuality(
                    route.geometry.coordinates
                );

                return {
                    id: `route-${index + 1}`,
                    route,
                    airQuality,
                };
            })
        );

        const validRoutes = routes.filter(
            (route): route is NonNullable<typeof route> => route !== null
        );

        if (validRoutes.length === 0) {
            return response(502, {
                error: "The routing service returned insufficient route geometry.",
            });
        }

        // Convert the existing route response into the scoring module's input.
        const scorableRoutes: ScorableRoute[] = validRoutes.map(
            (item) => ({
                id: item.id,

                route: {
                    properties: {
                        distanceMeters:
                            item.route.properties.distanceMeters,

                        durationSeconds:
                            item.route.properties.durationSeconds,
                    },
                },

                airQuality: {
                    status:
                        item.airQuality.status === "available"
                            ? "available"
                            : "unavailable",

                    indexCode: item.airQuality.indexCode,

                    sampleCount:
                        item.airQuality.sampleCount,

                    availableSampleCount:
                        item.airQuality.availableSampleCount,

                    averageAqi:
                        item.airQuality.averageAqi,

                    maxAqi:
                        item.airQuality.maxAqi,
                },
            })
        );

        // Rank the routes using the user's preferences.
        const scoring = scoreRoutes(scorableRoutes, {
            pollutionPreference:
                body.pollutionPreference,

            maxExtraTimePercent:
                body.maxExtraTimePercent,
        });

        // Select the recommended route, or the fastest fallback
        // when there is insufficient AQI coverage.
        const selectedRoute = validRoutes.find(
            (item) =>
                item.id === scoring.recommendedRouteId
        );

        const fastestRoute = validRoutes.find(
            (item) =>
                item.id === scoring.fastestRouteId
        );

        if (!selectedRoute) {
            return response(502, {
                error: "Unable to select a route.",
            });
        }

        // Preserve the original fields for existing frontend clients.
        // `route` and `airQuality` now refer to the selected route.
        return response(200, {
            route: selectedRoute.route,

            airQuality: selectedRoute.airQuality,

            routes: validRoutes,

            routeCount: validRoutes.length,

            alternativesRequested: MAX_ALTERNATIVES,

            recommendation: {
                status: scoring.status,

                recommendedRouteId:
                    scoring.recommendedRouteId,

                fastestRouteId:
                    scoring.fastestRouteId,

                fastestRoute:
                    fastestRoute
                        ? {
                            id: fastestRoute.id,
                            route: fastestRoute.route,
                            airQuality: fastestRoute.airQuality,
                        }
                        : null,

                scoring: {
                    pollutionPreference:
                        scoring.pollutionPreference,

                    maxExtraTimePercent:
                        scoring.maxExtraTimePercent,

                    fastestDurationSeconds:
                        scoring.fastestDurationSeconds,

                    maximumAllowedDurationSeconds:
                        scoring.maximumAllowedDurationSeconds,

                    message: scoring.message,

                    routes: scoring.routes,
                },
            },
        });
    } catch (error) {
        console.error("Route handler error:", error);
        return response(500, {
            error:
                error instanceof Error
                    ? error.message
                    : "An unexpected server error occurred.",
        });
    }
};
