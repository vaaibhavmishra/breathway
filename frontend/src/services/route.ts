export type Coordinates = [longitude: number, latitude: number];

export type RouteFeature = {
    type: "Feature";
    geometry: {
        type: "LineString";
        coordinates: Coordinates[];
    };
    properties: {
        distanceMeters: number;
        durationSeconds: number;
        [key: string]: unknown;
    };
};

export type AirQualitySample = {
    coordinate: Coordinates;
    longitude: number;
    latitude: number;
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

export type AirQualityData = {
    status: "available" | "unavailable";
    indexCode: string | null;
    sampleCount: number;
    availableSampleCount: number;
    averageAqi: number | null;
    maxAqi: number | null;
    samples: AirQualitySample[];
};

export type RouteOption = {
    id: string;
    route: RouteFeature;
    airQuality: AirQualityData;
};

/**
 * Individual route scoring details returned by the backend.
 *
 * The index signature allows additional scoring fields to be
 * returned by the backend without breaking the frontend types.
 */
export type RouteScoringDetail = {
    routeId?: string;
    score?: number | null;
    eligible?: boolean;
    reason?: string;
    [key: string]: unknown;
};

/**
 * Recommendation metadata returned by the route-scoring backend.
 */
export type RouteRecommendation = {
    status: "available" | "unavailable";
    recommendedRouteId: string | null;
    fastestRouteId: string | null;

    fastestRoute: {
        id: string;
        route: RouteFeature;
        airQuality: AirQualityData;
    } | null;

    scoring: {
        pollutionPreference: number;
        maxExtraTimePercent: number;
        fastestDurationSeconds: number;
        maximumAllowedDurationSeconds: number;
        message: string;
        routes: RouteScoringDetail[];
    };
};

/**
 * Complete response returned by the BreathWay route API.
 */
export type RouteApiResponse = {
    route: RouteFeature;
    airQuality: AirQualityData;
    routes: RouteOption[];
    routeCount?: number;
    alternativesRequested?: number;
    recommendation?: RouteRecommendation;
};

export type ActivityMode = "running" | "cycling" | "driving";

/**
 * Ventilation rates in Liters/min based on athletic respiratory studies.
 */
export const VENTILATION_RATES: Record<ActivityMode, number> = {
    running: 65,  // ~65 L/min during moderate aerobic running
    cycling: 45,  // ~45 L/min during sustained cycling
    driving: 10,  // ~10 L/min at rest in a vehicle
};

/**
 * Estimate inhaled PM2.5 lung load (in micrograms µg).
 * Inhaled PM2.5 = Air Volume (m³) × PM2.5 concentration (µg/m³).
 */
export function estimateInhaledDose(
    averageAqi: number | null,
    durationSeconds: number,
    mode: ActivityMode = "running"
): number | null {
    if (averageAqi === null || !Number.isFinite(averageAqi) || durationSeconds <= 0) {
        return null;
    }
    const estimatedPm25 = Math.max(5, averageAqi * 0.65);
    const durationMinutes = durationSeconds / 60;
    const ventilationLitersPerMin = VENTILATION_RATES[mode];
    const totalVolumeM3 = (ventilationLitersPerMin * durationMinutes) / 1000;
    return Math.round(totalVolumeM3 * estimatedPm25);
}

/**
 * Convert inhaled PM2.5 mass (µg) into cigarette equivalent particulate burden.
 * Based on the Berkeley Earth epidemiological model (Muller & Rohde):
 * Inhaling ~330 µg of PM2.5 particulate represents the toxic mass burden of smoking 1 cigarette.
 */
export function estimateCigaretteEquivalent(
    pm25Micrograms: number | null
): number | null {
    if (
        pm25Micrograms === null ||
        !Number.isFinite(pm25Micrograms) ||
        pm25Micrograms <= 0
    ) {
        return null;
    }
    const cigs = pm25Micrograms / 330;
    return Number(cigs.toFixed(2));
}

export function formatCigaretteEquivalent(cigs: number | null): string {
    if (cigs === null || !Number.isFinite(cigs) || cigs <= 0) return "0 cigs";
    if (cigs < 0.1) return "<0.1 cigs";
    return `${cigs.toFixed(1)} cig${cigs === 1 ? "" : "s"}`;
}

/**
 * Estimate percentage of the WHO recommended daily PM2.5 particulate limit (~216 µg for standard daily volume).
 */
export function estimateWhoDailyBudgetPercent(
    pm25Micrograms: number | null
): number | null {
    if (
        pm25Micrograms === null ||
        !Number.isFinite(pm25Micrograms) ||
        pm25Micrograms <= 0
    ) {
        return null;
    }
    return Math.round((pm25Micrograms / 216) * 100);
}

/**
 * Format speed or pace for athletics (min/km for runners, km/h for cyclists).
 */
export function formatAthleticPace(
    meters: number,
    seconds: number,
    mode: ActivityMode
): string {
    if (meters <= 0 || seconds <= 0) return "—";
    const km = meters / 1000;
    if (mode === "running") {
        const secondsPerKm = seconds / km;
        const paceMin = Math.floor(secondsPerKm / 60);
        const paceSec = Math.round(secondsPerKm % 60);
        return `${paceMin}:${paceSec.toString().padStart(2, "0")} /km`;
    }
    if (mode === "cycling") {
        const hours = seconds / 3600;
        const kmh = km / hours;
        return `${kmh.toFixed(1)} km/h`;
    }
    return `${Math.round(seconds / 60)} min`;
}

/**
 * Generate a Google Maps Universal Directions URL pinned with key clean-air waypoints.
 * Locks navigation to BreathWay's clean corridor rather than recalculating polluted arterial roads.
 */
export function generateGoogleMapsUrl(
    route: RouteFeature,
    mode: ActivityMode = "running"
): string {
    const coords = route.geometry.coordinates;
    if (!coords || coords.length === 0) {
        return "https://www.google.com/maps";
    }

    const [startLon, startLat] = coords[0];
    const [endLon, endLat] = coords[coords.length - 1];

    const origin = `${startLat.toFixed(5)},${startLon.toFixed(5)}`;
    const destination = `${endLat.toFixed(5)},${endLon.toFixed(5)}`;

    const travelMode =
        mode === "running" ? "walking" : mode === "cycling" ? "bicycling" : "driving";

    // Sample 1 to 6 intermediate waypoints along the clean path to force Google Maps
    // to stick to BreathWay's low-pollution corridor and prevent loops from collapsing.
    const waypoints: string[] = [];
    if (coords.length > 2) {
        const numWaypoints = Math.min(6, Math.max(1, Math.floor(coords.length / 8)));
        const step = (coords.length - 1) / (numWaypoints + 1);
        for (let i = 1; i <= numWaypoints; i++) {
            const index = Math.round(i * step);
            if (index > 0 && index < coords.length - 1) {
                const [lon, lat] = coords[index];
                waypoints.push(`${lat.toFixed(5)},${lon.toFixed(5)}`);
            }
        }
    }

    const params = new URLSearchParams({
        api: "1",
        origin,
        destination,
        travelmode: travelMode,
    });

    if (waypoints.length > 0) {
        params.set("waypoints", waypoints.join("|"));
    }

    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Generate and download a standard .gpx file for Garmin, Apple Watch, or Strava import.
 */
export function downloadRouteGpx(
    route: RouteFeature,
    fileName = "breathway-clean-route"
): void {
    const coords = route.geometry.coordinates;
    if (!coords || coords.length === 0) return;

    const trkpts = coords
        .map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`)
        .join("\n");

    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BreathWay Clean-Air Navigator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${fileName}</name>
    <desc>Clean-air athletic route generated by BreathWay</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${fileName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpxContent], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}.gpx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Generate circuit / loop waypoints around a center point for workout loops.
 */
export function generateLoopWaypoints(
    origin: Coordinates,
    targetDistanceKm: number,
    angleOffsetDegrees = 45
): { waypoints: Coordinates[]; destination: Coordinates } {
    const [lon, lat] = origin;
    const radiusKm = Math.max(0.6, targetDistanceKm / 3.6);
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const rad1 = (angleOffsetDegrees * Math.PI) / 180;
    const rad2 = ((angleOffsetDegrees + 90) * Math.PI) / 180;

    const wp1: Coordinates = [
        Number((lon + lonDelta * Math.cos(rad1)).toFixed(6)),
        Number((lat + latDelta * Math.sin(rad1)).toFixed(6)),
    ];
    const wp2: Coordinates = [
        Number((lon + lonDelta * Math.cos(rad2)).toFixed(6)),
        Number((lat + latDelta * Math.sin(rad2)).toFixed(6)),
    ];

    return {
        waypoints: [wp1, wp2],
        destination: [lon, lat],
    };
}

/**
 * Optional preferences used when calculating a route.
 */
export type RoutePreferences = {
    activityMode?: ActivityMode;
    travelMode?: "pedestrian" | "bicycle" | "car" | "running" | "cycling" | "driving";
    waypoints?: Coordinates[];
    pollutionPreference?: number;
    maxExtraTimePercent?: number;
};

type RouteApiError = {
    error?: string;
    message?: string;
};

const API_URL = import.meta.env.VITE_BREATHWAY_API_URL as
    | string
    | undefined;

/**
 * Accept either an API Gateway base URL or the complete
 * /api/routes endpoint.
 */
function getRouteEndpoint(configuredUrl: string): string {
    const normalizedUrl = configuredUrl.replace(/\/+$/, "");

    return normalizedUrl.endsWith("/api/routes")
        ? normalizedUrl
        : `${normalizedUrl}/api/routes`;
}

/**
 * Validate a longitude/latitude coordinate pair.
 */
function isValidCoordinates(value: unknown): value is Coordinates {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number" &&
        Number.isFinite(value[0]) &&
        Number.isFinite(value[1]) &&
        value[0] >= -180 &&
        value[0] <= 180 &&
        value[1] >= -90 &&
        value[1] <= 90
    );
}

/**
 * Validate a route GeoJSON feature.
 */
function isValidRoute(value: unknown): value is RouteFeature {
    if (!value || typeof value !== "object") {
        return false;
    }

    const route = value as RouteFeature;

    return (
        route.type === "Feature" &&
        route.geometry?.type === "LineString" &&
        Array.isArray(route.geometry.coordinates) &&
        route.geometry.coordinates.length >= 2 &&
        route.geometry.coordinates.every(isValidCoordinates) &&
        typeof route.properties?.distanceMeters === "number" &&
        Number.isFinite(route.properties.distanceMeters) &&
        typeof route.properties?.durationSeconds === "number" &&
        Number.isFinite(route.properties.durationSeconds)
    );
}

/**
 * Validate air-quality data returned by the backend.
 */
function isValidAirQuality(value: unknown): value is AirQualityData {
    if (!value || typeof value !== "object") {
        return false;
    }

    const data = value as AirQualityData;

    return (
        Array.isArray(data.samples) &&
        (data.status === "available" ||
            data.status === "unavailable") &&
        data.samples.every(
            (sample) =>
                sample !== null &&
                typeof sample === "object" &&
                isValidCoordinates(sample.coordinate) &&
                typeof sample.longitude === "number" &&
                Number.isFinite(sample.longitude) &&
                typeof sample.latitude === "number" &&
                Number.isFinite(sample.latitude) &&
                (sample.status === "available" ||
                    sample.status === "unavailable")
        )
    );
}

/**
 * Validate an individual route option.
 */
function isValidRouteOption(value: unknown): value is RouteOption {
    if (!value || typeof value !== "object") {
        return false;
    }

    const option = value as RouteOption;

    return (
        typeof option.id === "string" &&
        isValidRoute(option.route) &&
        isValidAirQuality(option.airQuality)
    );
}

/**
 * Validate the backend's optional recommendation metadata.
 */
function isValidRecommendation(
    value: unknown
): value is RouteRecommendation {
    if (!value || typeof value !== "object") {
        return false;
    }

    const recommendation = value as RouteRecommendation;

    if (
        (recommendation.status !== "available" &&
            recommendation.status !== "unavailable") ||
        !(
            typeof recommendation.recommendedRouteId === "string" ||
            recommendation.recommendedRouteId === null
        ) ||
        !(
            typeof recommendation.fastestRouteId === "string" ||
            recommendation.fastestRouteId === null
        ) ||
        !recommendation.scoring ||
        typeof recommendation.scoring !== "object" ||
        !Array.isArray(recommendation.scoring.routes)
    ) {
        return false;
    }

    if (recommendation.fastestRoute !== null) {
        const fastestRoute = recommendation.fastestRoute;

        if (
            !fastestRoute ||
            typeof fastestRoute !== "object" ||
            typeof fastestRoute.id !== "string" ||
            !isValidRoute(fastestRoute.route) ||
            !isValidAirQuality(fastestRoute.airQuality)
        ) {
            return false;
        }
    }

    const scoring = recommendation.scoring;

    return (
        typeof scoring.pollutionPreference === "number" &&
        Number.isFinite(scoring.pollutionPreference) &&
        typeof scoring.maxExtraTimePercent === "number" &&
        Number.isFinite(scoring.maxExtraTimePercent) &&
        typeof scoring.fastestDurationSeconds === "number" &&
        Number.isFinite(scoring.fastestDurationSeconds) &&
        typeof scoring.maximumAllowedDurationSeconds === "number" &&
        Number.isFinite(scoring.maximumAllowedDurationSeconds) &&
        typeof scoring.message === "string"
    );
}

/**
 * Calculate routes and AQI information from the BreathWay API.
 *
 * Default preferences:
 * - Pollution preference: 0.7
 * - Maximum extra travel time: 20%
 */
export async function calculateRoute(
    origin: Coordinates,
    destination: Coordinates,
    preferences: RoutePreferences = {}
): Promise<RouteApiResponse> {
    if (!API_URL) {
        throw new Error(
            "Missing VITE_BREATHWAY_API_URL. Check your frontend .env file."
        );
    }

    const pollutionPreference =
        preferences.pollutionPreference ?? 0.7;

    const maxExtraTimePercent =
        preferences.maxExtraTimePercent ?? 20;

    if (
        !Number.isFinite(pollutionPreference) ||
        pollutionPreference < 0 ||
        pollutionPreference > 1
    ) {
        throw new Error(
            "Pollution preference must be a number between 0 and 1."
        );
    }

    if (
        !Number.isFinite(maxExtraTimePercent) ||
        maxExtraTimePercent < 0 ||
        maxExtraTimePercent > 100
    ) {
        throw new Error(
            "Maximum extra travel time must be between 0 and 100 percent."
        );
    }

    const travelMode =
        preferences.activityMode === "running"
            ? "Pedestrian"
            : preferences.activityMode === "cycling"
              ? "Scooter"
              : preferences.travelMode ?? "Car";

    let isPedestrianFallback = false;
    let response = await fetch(getRouteEndpoint(API_URL), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            origin,
            destination,
            travelMode,
            waypoints: preferences.waypoints,
            pollutionPreference,
            maxExtraTimePercent,
        }),
    });

    if (!response.ok && travelMode === "Pedestrian") {
        try {
            const fallbackResponse = await fetch(getRouteEndpoint(API_URL), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    origin,
                    destination,
                    travelMode: "Scooter",
                    waypoints: preferences.waypoints,
                    pollutionPreference,
                    maxExtraTimePercent,
                }),
            });

            if (fallbackResponse.ok) {
                response = fallbackResponse;
                isPedestrianFallback = true;
            }
        } catch {
            // Keep original response error if fallback network call fails
        }
    }

    if (!response.ok) {
        let message = `Route request failed with status ${response.status}`;

        try {
            const errorBody: RouteApiError = await response.json();

            message =
                errorBody.error ??
                errorBody.message ??
                message;
        } catch {
            // Keep the HTTP status message if the response isn't JSON.
        }

        throw new Error(message);
    }

    const data: unknown = await response.json();

    if (!data || typeof data !== "object") {
        throw new Error(
            "Invalid response: the API returned unexpected data."
        );
    }

    const result = data as Partial<RouteApiResponse>;

    let routes: RouteOption[] = [];

    if (Array.isArray(result.routes)) {
        routes = result.routes.filter(isValidRouteOption);

        if (routes.length !== result.routes.length) {
            throw new Error(
                "Invalid route response: one or more alternative routes had an unexpected shape."
            );
        }
    } else if (
        isValidRoute(result.route) &&
        isValidAirQuality(result.airQuality)
    ) {
        // Backward compatibility with the original single-route API.
        routes = [
            {
                id: "route-1",
                route: result.route,
                airQuality: result.airQuality,
            },
        ];
    }

    if (routes.length === 0) {
        throw new Error(
            "Invalid route response: the API did not return a valid route and AQI data."
        );
    }

    if (isPedestrianFallback) {
        // Adjust scooter duration to realistic running pace (~2.78 m/s, approx 6 min/km)
        for (const opt of routes) {
            const dist = opt.route.properties.distanceMeters;
            if (dist > 0) {
                opt.route.properties.durationSeconds = Math.max(
                    60,
                    Math.round(dist / 2.78)
                );
            }
        }
    }

    // Recommendation metadata is optional.
    // If it doesn't match the expected shape, keep the valid routes
    // and let the frontend use its existing fallback logic.
    const recommendation = isValidRecommendation(result.recommendation)
        ? result.recommendation
        : undefined;

    // Prefer the backend's selected route when recommendation data exists.
    const recommendedRouteId =
        result.recommendation?.recommendedRouteId;

    const primary =
        routes.find((route) => route.id === recommendedRouteId) ??
        routes[0];

    return {
        route: primary.route,
        airQuality: primary.airQuality,
        routes,
        routeCount: result.routeCount ?? routes.length,
        alternativesRequested: result.alternativesRequested,
        recommendation,
    };
}