export type RouteAirQualitySummary = {
    status: "available" | "unavailable";
    indexCode: string | null;
    sampleCount: number;
    availableSampleCount: number;
    averageAqi: number | null;
    maxAqi: number | null;
};

export type ScorableRoute = {
    id: string;

    route: {
        properties: {
            distanceMeters: number;
            durationSeconds: number;
        };
    };

    airQuality: RouteAirQualitySummary;
};

export type RouteScoringOptions = {
    /**
     * 0 = prioritize travel time.
     * 1 = prioritize lower AQI.
     */
    pollutionPreference?: number;

    /**
     * Maximum additional travel time allowed
     * compared with the fastest route.
     *
     * Example: 20 means up to 20% longer.
     */
    maxExtraTimePercent?: number;

    /**
     * Minimum number of valid AQI samples required.
     */
    minimumAqiSamples?: number;

    /**
     * Minimum fraction of requested samples that
     * must have valid AQI data.
     *
     * Example: 0.5 means at least 50% coverage.
     */
    minimumAqiCoverage?: number;
};

export type ScoredRoute = {
    id: string;

    distanceMeters: number;
    durationSeconds: number;

    averageAqi: number | null;
    aqiCoverage: number;

    eligibleByTime: boolean;
    hasReliableAqi: boolean;

    /**
     * Lower is better.
     * Null means the route could not be scored
     * using AQI data.
     */
    score: number | null;

    recommendationEligible: boolean;

    reason: string;
};

export type RouteScoringResult = {
    status: "recommended" | "fastest_fallback" | "unavailable";

    recommendedRouteId: string | null;
    fastestRouteId: string | null;

    pollutionPreference: number;
    maxExtraTimePercent: number;

    fastestDurationSeconds: number | null;
    maximumAllowedDurationSeconds: number | null;

    routes: ScoredRoute[];

    message: string;
};

const DEFAULT_POLLUTION_PREFERENCE = 0.7;
const DEFAULT_MAX_EXTRA_TIME_PERCENT = 20;
const DEFAULT_MINIMUM_AQI_SAMPLES = 2;
const DEFAULT_MINIMUM_AQI_COVERAGE = 0.5;

function isFiniteNonNegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function normalize(
    value: number,
    minimum: number,
    maximum: number
): number {
    if (maximum === minimum) {
        return 0.5;
    }

    return (value - minimum) / (maximum - minimum);
}

export function scoreRoutes(
    inputRoutes: ScorableRoute[],
    options: RouteScoringOptions = {}
): RouteScoringResult {
    const pollutionPreference =
        options.pollutionPreference ??
        DEFAULT_POLLUTION_PREFERENCE;

    const maxExtraTimePercent =
        options.maxExtraTimePercent ??
        DEFAULT_MAX_EXTRA_TIME_PERCENT;

    const minimumAqiSamples =
        options.minimumAqiSamples ??
        DEFAULT_MINIMUM_AQI_SAMPLES;

    const minimumAqiCoverage =
        options.minimumAqiCoverage ??
        DEFAULT_MINIMUM_AQI_COVERAGE;

    if (
        !Number.isFinite(pollutionPreference) ||
        pollutionPreference < 0 ||
        pollutionPreference > 1
    ) {
        throw new Error(
            "pollutionPreference must be between 0 and 1."
        );
    }

    if (
        !Number.isFinite(maxExtraTimePercent) ||
        maxExtraTimePercent < 0 ||
        maxExtraTimePercent > 100
    ) {
        throw new Error(
            "maxExtraTimePercent must be between 0 and 100."
        );
    }

    if (
        !Number.isInteger(minimumAqiSamples) ||
        minimumAqiSamples < 1
    ) {
        throw new Error(
            "minimumAqiSamples must be a positive integer."
        );
    }

    if (
        !Number.isFinite(minimumAqiCoverage) ||
        minimumAqiCoverage < 0 ||
        minimumAqiCoverage > 1
    ) {
        throw new Error(
            "minimumAqiCoverage must be between 0 and 1."
        );
    }

    if (inputRoutes.length === 0) {
        return {
            status: "unavailable",
            recommendedRouteId: null,
            fastestRouteId: null,
            pollutionPreference,
            maxExtraTimePercent,
            fastestDurationSeconds: null,
            maximumAllowedDurationSeconds: null,
            routes: [],
            message: "No routes were provided for comparison.",
        };
    }

    const routeIds = new Set<string>();

    for (const route of inputRoutes) {
        if (!route.id || routeIds.has(route.id)) {
            throw new Error(
                "Every route must have a unique, non-empty id."
            );
        }

        routeIds.add(route.id);

        if (!isFiniteNonNegative(route.route.properties.distanceMeters)) {
            route.route.properties.distanceMeters = 0;
        }

        if (
            !Number.isFinite(route.route.properties.durationSeconds) ||
            route.route.properties.durationSeconds <= 0
        ) {
            if (route.route.properties.distanceMeters > 0) {
                // Approximate fallback duration (~3 m/s)
                route.route.properties.durationSeconds = Math.max(
                    30,
                    Math.round(route.route.properties.distanceMeters / 3)
                );
            } else {
                throw new Error(
                    `Route ${route.id} has invalid distance or duration.`
                );
            }
        }

        const aq = route.airQuality;

        if (
            !Number.isInteger(aq.sampleCount) ||
            aq.sampleCount < 0 ||
            !Number.isInteger(aq.availableSampleCount) ||
            aq.availableSampleCount < 0 ||
            aq.availableSampleCount > aq.sampleCount
        ) {
            throw new Error(
                `Route ${route.id} has invalid AQI sample counts.`
            );
        }

        if (
            aq.averageAqi !== null &&
            (
                !Number.isFinite(aq.averageAqi) ||
                aq.averageAqi < 0
            )
        ) {
            throw new Error(
                `Route ${route.id} has an invalid average AQI.`
            );
        }
    }

    // The fastest valid route establishes the travel-time baseline.
    const fastestRoute = [...inputRoutes].sort(
        (a, b) =>
            a.route.properties.durationSeconds -
            b.route.properties.durationSeconds
    )[0];

    const fastestDurationSeconds =
        fastestRoute.route.properties.durationSeconds;

    const maximumAllowedDurationSeconds =
        fastestDurationSeconds *
        (1 + maxExtraTimePercent / 100);

    const preparedRoutes = inputRoutes.map((route) => {
        const {
            distanceMeters,
            durationSeconds,
        } = route.route.properties;

        const aq = route.airQuality;

        const aqiCoverage =
            aq.sampleCount > 0
                ? aq.availableSampleCount / aq.sampleCount
                : 0;

        const hasReliableAqi =
            aq.status === "available" &&
            aq.averageAqi !== null &&
            aq.availableSampleCount >= minimumAqiSamples &&
            aqiCoverage >= minimumAqiCoverage;

        const eligibleByTime =
            durationSeconds <=
            maximumAllowedDurationSeconds;

        return {
            id: route.id,
            distanceMeters,
            durationSeconds,
            averageAqi: aq.averageAqi,
            aqiCoverage,
            eligibleByTime,
            hasReliableAqi,
            score: null as number | null,
            recommendationEligible:
                eligibleByTime && hasReliableAqi,
            reason: "",
        };
    });

    const routesWithReliableAqi = preparedRoutes.filter(
        (route) =>
            route.eligibleByTime &&
            route.hasReliableAqi &&
            route.averageAqi !== null
    );

    // Without sufficient AQI data, do not pretend that
    // a route is cleaner than another route.
    if (routesWithReliableAqi.length === 0) {
        const fallbackRoutes = preparedRoutes.map((route) => ({
            ...route,
            reason:
                route.id === fastestRoute.id
                    ? "Fastest route selected because no route within the time limit has sufficient AQI coverage."
                    : route.hasReliableAqi
                      ? "Not selected because it exceeds the extra-time limit or is slower than the fallback route."
                      : "Not selected because AQI coverage is insufficient.",
        }));

        return {
            status: "fastest_fallback",
            recommendedRouteId: fastestRoute.id,
            fastestRouteId: fastestRoute.id,
            pollutionPreference,
            maxExtraTimePercent,
            fastestDurationSeconds,
            maximumAllowedDurationSeconds,
            routes: fallbackRoutes,
            message:
                "AQI coverage is insufficient for a reliable cleaner-route recommendation. The fastest route is shown instead.",
        };
    }

    const aqiValues = routesWithReliableAqi.map(
        (route) => route.averageAqi as number
    );

    const durationValues = routesWithReliableAqi.map(
        (route) => route.durationSeconds
    );

    const minimumAqi = Math.min(...aqiValues);
    const maximumAqi = Math.max(...aqiValues);

    const minimumDuration = Math.min(...durationValues);
    const maximumDuration = Math.max(...durationValues);

    const scoredCandidates = routesWithReliableAqi.map(
        (route) => {
            const normalizedAqi = normalize(
                route.averageAqi as number,
                minimumAqi,
                maximumAqi
            );

            const normalizedDuration = normalize(
                route.durationSeconds,
                minimumDuration,
                maximumDuration
            );

            const score =
                pollutionPreference * normalizedAqi +
                (1 - pollutionPreference) *
                    normalizedDuration;

            return {
                ...route,
                score: Number(score.toFixed(4)),
            };
        }
    );

    // Lowest score wins. Distance is a tie-breaker.
    scoredCandidates.sort(
        (a, b) =>
            (a.score as number) - (b.score as number) ||
            a.distanceMeters - b.distanceMeters
    );

    const recommendedRoute = scoredCandidates[0];

    const scoredById = new Map(
        scoredCandidates.map((route) => [
            route.id,
            route,
        ])
    );

    const routes = preparedRoutes.map((route) => {
        const scored = scoredById.get(route.id);

        if (scored) {
            return {
                ...scored,
                reason:
                    route.id === recommendedRoute.id
                        ? "Recommended: best balance of AQI and travel time within the time limit."
                        : "Eligible for comparison, but its combined AQI and travel-time score is higher.",
            };
        }

        if (!route.eligibleByTime) {
            return {
                ...route,
                reason:
                    "Excluded because it exceeds the extra-time limit.",
            };
        }

        if (!route.hasReliableAqi) {
            return {
                ...route,
                reason:
                    "Excluded from cleaner-route ranking because AQI coverage is insufficient.",
            };
        }

        return {
            ...route,
            reason: "Not eligible for recommendation.",
        };
    });

    return {
        status: "recommended",
        recommendedRouteId: recommendedRoute.id,
        fastestRouteId: fastestRoute.id,
        pollutionPreference,
        maxExtraTimePercent,
        fastestDurationSeconds,
        maximumAllowedDurationSeconds,
        routes,
        message:
            "Recommended route selected using AQI and travel time, subject to the extra-time limit.",
    };
}