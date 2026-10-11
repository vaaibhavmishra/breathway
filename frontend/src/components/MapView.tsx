import { useEffect, useRef, useState } from "react";
import {
    LngLatBounds,
    Map,
    Marker,
    NavigationControl,
    Popup,
    setWorkerUrl,
} from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
    IconWind,
    IconRoute,
    IconClock,
    IconAdjustmentsHorizontal,
    IconChevronDown,
    IconChevronUp,
    IconChevronLeft,
    IconChevronRight,
    IconSearch,
    IconX,
    IconShieldCheck,
    IconArrowsExchange,
    IconFocus2,
    IconAlertCircle,
    IconMapPin,
    IconRefresh,
    IconRun,
    IconBike,
    IconCar,
    IconRotate,
    IconFlame,
    IconSmoking,
    IconSmokingNo,
    IconHeartbeat,
    IconSparkles,
    IconCheck,
    IconShare,
    IconBrandGoogleMaps,
    IconDownload,
    IconExternalLink,
} from "@tabler/icons-react";

import {
    calculateRoute,
    estimateInhaledDose,
    estimateCigaretteEquivalent,
    formatCigaretteEquivalent,
    formatAthleticPace,
    generateLoopWaypoints,
    generateGoogleMapsUrl,
    downloadRouteGpx,
    VENTILATION_RATES,
    type ActivityMode,
    type AirQualitySample,
    type Coordinates,
    type RouteApiResponse,
} from "../services/route";
import { searchPlaces, type PlaceSuggestion } from "../services/places";

setWorkerUrl(maplibreWorker);

const AWS_REGION = import.meta.env.VITE_AWS_REGION ?? "ap-southeast-2";
const AWS_LOCATION_API_KEY = import.meta.env.VITE_AWS_LOCATION_API_KEY;

const MAP_STYLE = `https://maps.geo.${AWS_REGION}.amazonaws.com/v2/styles/Standard/descriptor?key=${AWS_LOCATION_API_KEY}`;

const ORIGIN: Coordinates = [77.209, 28.6139];
const DESTINATION: Coordinates = [77.229, 28.635];

type AqiColor = {
    color: string;
    label: string;
    bgSubtle: string;
    borderSubtle: string;
    textColor: string;
};

const CPCB_LEVELS: {
    max: number;
    color: string;
    label: string;
    bgSubtle: string;
    borderSubtle: string;
    textColor: string;
    desc: string;
}[] = [
    {
        max: 50,
        color: "#10b981",
        label: "Good",
        bgSubtle: "#ecfdf5",
        borderSubtle: "#a7f3d0",
        textColor: "#065f46",
        desc: "Minimal impact on health",
    },
    {
        max: 100,
        color: "#ca8a04",
        label: "Satisfactory",
        bgSubtle: "#fefce8",
        borderSubtle: "#fef08a",
        textColor: "#854d0e",
        desc: "Minor breathing discomfort to sensitive people",
    },
    {
        max: 200,
        color: "#ea580c",
        label: "Moderate",
        bgSubtle: "#fff7ed",
        borderSubtle: "#fed7aa",
        textColor: "#9a3412",
        desc: "Breathing discomfort with lung or heart conditions",
    },
    {
        max: 300,
        color: "#dc2626",
        label: "Poor",
        bgSubtle: "#fef2f2",
        borderSubtle: "#fecaca",
        textColor: "#991b1b",
        desc: "Discomfort to most people upon prolonged exposure",
    },
    {
        max: 400,
        color: "#9333ea",
        label: "Very Poor",
        bgSubtle: "#faf5ff",
        borderSubtle: "#e9d5ff",
        textColor: "#6b21a8",
        desc: "Respiratory illness risk on prolonged exposure",
    },
    {
        max: Infinity,
        color: "#881337",
        label: "Severe",
        bgSubtle: "#fff1f2",
        borderSubtle: "#fecdd3",
        textColor: "#4c0519",
        desc: "Serious health impact even for healthy individuals",
    },
];

function getAqiColor(aqi: number): AqiColor {
    for (const level of CPCB_LEVELS) {
        if (aqi <= level.max) {
            return {
                color: level.color,
                label: level.label,
                bgSubtle: level.bgSubtle,
                borderSubtle: level.borderSubtle,
                textColor: level.textColor,
            };
        }
    }
    const severe = CPCB_LEVELS[CPCB_LEVELS.length - 1];
    return {
        color: severe.color,
        label: severe.label,
        bgSubtle: severe.bgSubtle,
        borderSubtle: severe.borderSubtle,
        textColor: severe.textColor,
    };
}

const POLLUTANT_INFO: Record<string, string> = {
    "PM2.5": "Fine particulate matter (<2.5µm) from vehicle exhaust and smog",
    PM10: "Inhalable dust and coarse particles (<10µm)",
    NO2: "Nitrogen dioxide from combustion and vehicular exhaust",
    O3: "Ground-level ozone from sunlight reacting with pollutants",
    CO: "Carbon monoxide from incomplete engine combustion",
    SO2: "Sulfur dioxide from industrial fuel emissions",
};

function formatDistance(meters: number): string {
    return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
}

function formatObservationTime(value?: string): string {
    if (!value) return "Time unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Time unavailable";
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
    }).format(date);
}

function getDominantPollutant(samples: AirQualitySample[]): string {
    const counts = new globalThis.Map<string, number>();
    for (const sample of samples) {
        if (sample.status !== "available" || !sample.dominantPollutant) {
            continue;
        }
        const pollutant = sample.dominantPollutant.toUpperCase();
        counts.set(pollutant, (counts.get(pollutant) ?? 0) + 1);
    }
    let dominant = "";
    let highestCount = 0;
    for (const [pollutant, count] of counts) {
        if (count > highestCount) {
            dominant = pollutant;
            highestCount = count;
        }
    }
    return dominant || "Unavailable";
}

function createAqiMarker(sample: AirQualitySample, index: number): Marker {
    const element = document.createElement("div");
    const hasAqi =
        sample.status === "available" &&
        typeof sample.aqi === "number" &&
        Number.isFinite(sample.aqi);

    const aqiMeta = hasAqi
        ? getAqiColor(sample.aqi!)
        : {
              color: "#64748b",
              label: "Unavailable",
              bgSubtle: "#f1f5f9",
              borderSubtle: "#cbd5e1",
              textColor: "#475569",
          };

    element.innerHTML = `
        <div style="
            min-width: 32px;
            height: 32px;
            padding: 0 5px;
            border-radius: 9999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background-color: ${aqiMeta.color};
            color: #ffffff;
            border: 2.5px solid #ffffff;
            box-shadow: 0 4px 14px rgba(15, 23, 42, 0.32);
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
            transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        ">
            ${hasAqi ? sample.aqi : "?"}
        </div>
    `;

    element.addEventListener("mouseenter", () => {
        element.style.transform = "scale(1.2)";
    });
    element.addEventListener("mouseleave", () => {
        element.style.transform = "scale(1)";
    });

    const popupContent = document.createElement("div");
    popupContent.style.padding = "14px 16px";
    popupContent.style.minWidth = "220px";

    const dominantUpper = sample.dominantPollutant
        ? sample.dominantPollutant.toUpperCase()
        : null;
    const desc = dominantUpper ? POLLUTANT_INFO[dominantUpper] : null;

    popupContent.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: 700; color: #64748b;">Waypoint ${index + 1}</span>
            <span style="font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 9999px; background: ${aqiMeta.bgSubtle}; color: ${aqiMeta.textColor}; border: 1px solid ${aqiMeta.borderSubtle};">
                ${hasAqi ? aqiMeta.label : "Unavailable"}
            </span>
        </div>
        <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 10px;">
            <span style="font-size: 26px; font-weight: 800; color: #0f172a; line-height: 1;">${hasAqi ? sample.aqi : "—"}</span>
            <span style="font-size: 11px; font-weight: 600; color: #64748b;">CPCB AQI</span>
        </div>
        <div style="font-size: 11px; color: #334155; border-top: 1px solid #f1f5f9; padding-top: 8px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between;">
                <span style="color: #64748b;">Dominant pollutant</span>
                <span style="font-weight: 700; color: #0f172a;">${dominantUpper ?? "Unavailable"}</span>
            </div>
            ${desc ? `<div style="font-size: 10px; color: #64748b; line-height: 1.35; margin-top: 2px;">${desc}</div>` : ""}
            <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">Updated: ${formatObservationTime(sample.observedAt)}</div>
        </div>
    `;

    const popup = new Popup({
        offset: 20,
        closeButton: true,
        maxWidth: "260px",
    }).setDOMContent(popupContent);

    return new Marker({
        element,
        anchor: "center",
    })
        .setLngLat(sample.coordinate)
        .setPopup(popup);
}

function getCleanestRoute(routes: RouteApiResponse["routes"]): string | null {
    const routesWithAqi = routes.filter(
        (option) =>
            option.airQuality.status === "available" &&
            option.airQuality.averageAqi !== null &&
            Number.isFinite(option.airQuality.averageAqi)
    );
    if (routesWithAqi.length === 0) return null;
    return routesWithAqi.reduce((cleanest, current) =>
        current.airQuality.averageAqi! < cleanest.airQuality.averageAqi!
            ? current
            : cleanest
    ).id;
}

function getRecommendedRoute(
    routes: RouteApiResponse["routes"],
    maxExtraTimePercent: number
): string | null {
    const validRoutes = routes.filter(
        (option) =>
            Number.isFinite(option.route.properties.durationSeconds) &&
            option.route.properties.durationSeconds > 0
    );
    if (validRoutes.length === 0) return null;

    const fastestDuration = Math.min(
        ...validRoutes.map((option) => option.route.properties.durationSeconds)
    );
    if (maxExtraTimePercent === 0) {
        return (
            validRoutes.find(
                (option) =>
                    option.route.properties.durationSeconds === fastestDuration
            )?.id ?? null
        );
    }
    const maximumDuration = fastestDuration * (1 + maxExtraTimePercent / 100);
    const eligibleRoutes = validRoutes.filter(
        (option) =>
            option.route.properties.durationSeconds <= maximumDuration &&
            option.airQuality.status === "available" &&
            option.airQuality.averageAqi !== null &&
            Number.isFinite(option.airQuality.averageAqi)
    );
    if (eligibleRoutes.length === 0) {
        return (
            validRoutes.find(
                (option) =>
                    option.route.properties.durationSeconds === fastestDuration
            )?.id ?? validRoutes[0]?.id ?? null
        );
    }
    return eligibleRoutes.reduce((best, current) =>
        current.airQuality.averageAqi! < best.airQuality.averageAqi!
            ? current
            : best
    ).id;
}

function getEligibleRouteCount(
    routes: RouteApiResponse["routes"],
    maxExtraTimePercent: number
): number {
    const durations = routes
        .map((option) => option.route.properties.durationSeconds)
        .filter((duration) => Number.isFinite(duration) && duration > 0);
    if (durations.length === 0) return 0;
    const maximumDuration =
        Math.min(...durations) * (1 + maxExtraTimePercent / 100);
    return routes.filter(
        (option) =>
            Number.isFinite(option.route.properties.durationSeconds) &&
            option.route.properties.durationSeconds > 0 &&
            option.route.properties.durationSeconds <= maximumDuration
    ).length;
}

export default function MapView() {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<Map | null>(null);
    const aqiMarkersRef = useRef<Marker[]>([]);
    const endpointMarkersRef = useRef<Marker[]>([]);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [routeLoading, setRouteLoading] = useState(() =>
        Boolean(AWS_LOCATION_API_KEY)
    );
    const [routeData, setRouteData] = useState<RouteApiResponse | null>(null);
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

    const [maxExtraTimePercent, setMaxExtraTimePercent] = useState(15);
    const [pollutionPreference, setPollutionPreference] = useState(0.7);

    const [originText, setOriginText] = useState("Central Delhi");
    const [destinationText, setDestinationText] = useState("Delhi");

    const [originSuggestions, setOriginSuggestions] = useState<
        PlaceSuggestion[]
    >([]);
    const [destinationSuggestions, setDestinationSuggestions] = useState<
        PlaceSuggestion[]
    >([]);
    const [originSearching, setOriginSearching] = useState(false);
    const [destinationSearching, setDestinationSearching] = useState(false);
    const [placeSearchError, setPlaceSearchError] = useState<string | null>(
        null
    );

    const [originSearchActive, setOriginSearchActive] = useState(false);
    const [destinationSearchActive, setDestinationSearchActive] = useState(false);

    const [originCoordinates, setOriginCoordinates] =
        useState<Coordinates>(ORIGIN);
    const [destinationCoordinates, setDestinationCoordinates] =
        useState<Coordinates>(DESTINATION);

    const activeSearchIdRef = useRef(0);
    const [routeSourceReady, setRouteSourceReady] = useState(false);
    const [routeError, setRouteError] = useState<string | null>(null);
    const [mapError] = useState<string | null>(() =>
        !AWS_LOCATION_API_KEY
            ? "Missing AWS Location API key. Check your frontend .env configuration."
            : null
    );

    const [activityMode, setActivityMode] = useState<ActivityMode>("running");
    const [isLoopMode, setIsLoopMode] = useState(false);
    const [targetLoopDistanceKm, setTargetLoopDistanceKm] = useState(5);

    const [panelCollapsed, setPanelCollapsed] = useState(false);
    const [preferencesExpanded, setPreferencesExpanded] = useState(false);
    const searchFormRef = useRef<HTMLFormElement | null>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (
                searchFormRef.current &&
                !searchFormRef.current.contains(e.target as Node)
            ) {
                setOriginSuggestions([]);
                setDestinationSuggestions([]);
                setOriginSearchActive(false);
                setDestinationSearchActive(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const selectedRoute =
        routeData?.routes.find((option) => option.id === selectedRouteId) ??
        routeData?.routes[0] ??
        null;

    const cleanestRouteId = routeData
        ? getCleanestRoute(routeData.routes)
        : null;

    const recommendedRouteId =
        routeData?.recommendation?.recommendedRouteId ??
        (routeData
            ? getRecommendedRoute(routeData.routes, maxExtraTimePercent)
            : null) ??
        routeData?.routes[0]?.id ??
        null;

    const fastestRoute = routeData
        ? routeData.routes.reduce((fastest, current) =>
              current.route.properties.durationSeconds <
              fastest.route.properties.durationSeconds
                  ? current
                  : fastest
          )
        : null;

    const recommendedRoute =
        routeData?.routes.find((option) => option.id === recommendedRouteId) ??
        null;

    const extraTravelMinutes =
        recommendedRoute && fastestRoute
            ? Math.max(
                  0,
                  Math.round(
                      (recommendedRoute.route.properties.durationSeconds -
                          fastestRoute.route.properties.durationSeconds) /
                          60
                  )
              )
            : null;

    const fastestAverageAqi = fastestRoute?.airQuality.averageAqi ?? null;
    const recommendedAverageAqi =
        recommendedRoute?.airQuality.averageAqi ?? null;

    const aqiDifference =
        fastestAverageAqi !== null && recommendedAverageAqi !== null
            ? Math.round(fastestAverageAqi - recommendedAverageAqi)
            : null;

    const recommendedDuration =
        recommendedRoute?.route.properties.durationSeconds ?? 0;
    const fastestDuration =
        fastestRoute?.route.properties.durationSeconds ?? 0;

    const recommendedInhaledDose = estimateInhaledDose(
        recommendedAverageAqi,
        recommendedDuration,
        activityMode
    );
    const fastestInhaledDose = estimateInhaledDose(
        fastestAverageAqi,
        fastestDuration,
        activityMode
    );

    const inhaledDoseDifference =
        fastestInhaledDose !== null && recommendedInhaledDose !== null
            ? Math.round(fastestInhaledDose - recommendedInhaledDose)
            : null;

    const recommendedCigarettes =
        estimateCigaretteEquivalent(recommendedInhaledDose);
    const fastestCigarettes = estimateCigaretteEquivalent(fastestInhaledDose);
    const sparedCigarettes =
        fastestCigarettes !== null &&
        recommendedCigarettes !== null &&
        fastestCigarettes > recommendedCigarettes
            ? Number((fastestCigarettes - recommendedCigarettes).toFixed(1))
            : null;

    const sparedDosePercent =
        fastestInhaledDose !== null &&
        recommendedInhaledDose !== null &&
        fastestInhaledDose > 0
            ? Math.max(
                  0,
                  Math.round(
                      ((fastestInhaledDose - recommendedInhaledDose) /
                          fastestInhaledDose) *
                          100
                  )
              )
            : 0;

    const [healthShieldOpen, setHealthShieldOpen] = useState(false);
    const [copiedSummary, setCopiedSummary] = useState(false);

    async function copyHealthShieldSummary() {
        if (!recommendedRoute) return;
        const distKm = (
            recommendedRoute.route.properties.distanceMeters / 1000
        ).toFixed(1);
        const timeStr = formatDuration(
            recommendedRoute.route.properties.durationSeconds
        );
        const aqiStr = recommendedAverageAqi ?? "—";
        const cigsSparedStr =
            sparedCigarettes && sparedCigarettes > 0
                ? `${sparedCigarettes} cigarettes avoided`
                : "clean air corridor";
        const doseSparedStr =
            inhaledDoseDifference && inhaledDoseDifference > 0
                ? `Spared ${inhaledDoseDifference} µg PM2.5`
                : "Optimal clean air";
        const gmapsLink = generateGoogleMapsUrl(recommendedRoute.route, activityMode);

        const text =
            `🏃 BreathWay Clean Workout Shield\n` +
            `Activity: ${activityMode === "running" ? "Running" : activityMode === "cycling" ? "Cycling" : "Commute"}\n` +
            `Distance: ${distKm} km (${timeStr}) | Avg AQI: ${aqiStr}\n` +
            `🛡️ Lung Shield: ${doseSparedStr} (equiv. to ~${cigsSparedStr})\n` +
            `📍 Clean Google Maps Route: ${gmapsLink}\n` +
            `Route for your lungs with BreathWay!`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: "BreathWay Clean Workout Shield",
                    text,
                    url: gmapsLink,
                });
                return;
            } catch {
                // User dismissed share dialog or unsupported, fallback to clipboard
            }
        }

        void navigator.clipboard.writeText(text);
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 2500);
    }

    const eligibleRouteCount = routeData
        ? getEligibleRouteCount(routeData.routes, maxExtraTimePercent)
        : 0;

    // Search for origin suggestions with debounce
    useEffect(() => {
        if (!originSearchActive) return;
        const query = originText.trim();
        if (query.length < 3) return;

        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setOriginSearching(true);
            setPlaceSearchError(null);
            try {
                const results = await searchPlaces(query);
                if (!cancelled) setOriginSuggestions(results);
            } catch (error) {
                if (!cancelled) {
                    setOriginSuggestions([]);
                    setPlaceSearchError(
                        error instanceof Error
                            ? error.message
                            : "Unable to search for locations."
                    );
                }
            } finally {
                if (!cancelled) setOriginSearching(false);
            }
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [originText, originSearchActive]);

    // Search for destination suggestions with debounce
    useEffect(() => {
        if (!destinationSearchActive) return;
        const query = destinationText.trim();
        if (query.length < 3) return;

        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setDestinationSearching(true);
            setPlaceSearchError(null);
            try {
                const results = await searchPlaces(query);
                if (!cancelled) setDestinationSuggestions(results);
            } catch (error) {
                if (!cancelled) {
                    setDestinationSuggestions([]);
                    setPlaceSearchError(
                        error instanceof Error
                            ? error.message
                            : "Unable to search for locations."
                    );
                }
            } finally {
                if (!cancelled) setDestinationSearching(false);
            }
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [destinationText, destinationSearchActive]);

    function selectOrigin(place: PlaceSuggestion) {
        setOriginText(place.title);
        setOriginCoordinates(place.coordinates);
        setOriginSuggestions([]);
        setOriginSearchActive(false);
        setPlaceSearchError(null);
    }

    function selectDestination(place: PlaceSuggestion) {
        setDestinationText(place.title);
        setDestinationCoordinates(place.coordinates);
        setDestinationSuggestions([]);
        setDestinationSearchActive(false);
        setPlaceSearchError(null);
    }

    function swapLocations() {
        const nextOriginText = destinationText;
        const nextDestinationText = originText;
        const nextOriginCoords = destinationCoordinates;
        const nextDestinationCoords = originCoordinates;

        setOriginText(nextOriginText);
        setDestinationText(nextDestinationText);
        setOriginCoordinates(nextOriginCoords);
        setDestinationCoordinates(nextDestinationCoords);
        setOriginSuggestions([]);
        setDestinationSuggestions([]);
        setOriginSearchActive(false);
        setDestinationSearchActive(false);
    }

    function fitMapToRoute(boundsTarget?: LngLatBounds) {
        const map = mapInstanceRef.current;
        if (!map) return;

        let bounds = boundsTarget;
        if (!bounds) {
            if (!routeData || routeData.routes.length === 0) return;
            bounds = new LngLatBounds();
            for (const option of routeData.routes) {
                for (const coordinate of option.route.geometry.coordinates) {
                    bounds.extend(coordinate);
                }
            }
        }

        const isMobile =
            typeof window !== "undefined" && window.innerWidth < 640;
        map.fitBounds(bounds, {
            padding: {
                top: isMobile ? 80 : 90,
                bottom: isMobile ? 80 : 80,
                left: isMobile ? 24 : panelCollapsed ? 70 : 440,
                right: isMobile ? 24 : 70,
            },
            maxZoom: 15,
            duration: 800,
        });
    }

    async function searchRoute(
        origin: Coordinates = originCoordinates,
        dest: Coordinates = destinationCoordinates,
        prefs: {
            pollutionPreference?: number;
            maxExtraTimePercent?: number;
            activityMode?: ActivityMode;
            loopMode?: boolean;
            loopDistanceKm?: number;
            waypoints?: Coordinates[];
        } = {}
    ) {
        const map = mapInstanceRef.current;
        if (!map || !mapLoaded || !routeSourceReady) return;

        const effectiveMode = prefs.activityMode ?? activityMode;
        const effectiveLoopMode = prefs.loopMode ?? isLoopMode;
        const effectiveLoopDist = prefs.loopDistanceKm ?? targetLoopDistanceKm;

        const searchId = ++activeSearchIdRef.current;
        setRouteLoading(true);
        setRouteError(null);

        let finalOrigin = origin;
        let finalDest = dest;
        let finalWaypoints = prefs.waypoints;

        if (effectiveLoopMode) {
            const loop = generateLoopWaypoints(origin, effectiveLoopDist);
            finalWaypoints = loop.waypoints;
            finalDest = loop.destination;
        }

        try {
            const result = await calculateRoute(finalOrigin, finalDest, {
                activityMode: effectiveMode,
                waypoints: finalWaypoints,
                pollutionPreference:
                    prefs.pollutionPreference ?? pollutionPreference,
                maxExtraTimePercent:
                    prefs.maxExtraTimePercent ?? maxExtraTimePercent,
            });

            if (searchId !== activeSearchIdRef.current) return;

            if (!result.routes || result.routes.length === 0) {
                throw new Error("No routes were returned for these locations.");
            }

            const routesGeoJson = {
                type: "FeatureCollection" as const,
                features: result.routes.map((option) => ({
                    ...option.route,
                    properties: {
                        ...option.route.properties,
                        routeId: option.id,
                    },
                })),
            };

            const source = map.getSource("breathway-route") as
                | import("maplibre-gl").GeoJSONSource
                | undefined;

            if (!source) {
                throw new Error("The route map source is unavailable.");
            }

            source.setData(routesGeoJson);
            setRouteData(result);

            const nextSelectedId =
                result.recommendation?.recommendedRouteId &&
                result.routes.some(
                    (option) =>
                        option.id === result.recommendation?.recommendedRouteId
                )
                    ? result.recommendation.recommendedRouteId
                    : result.routes[0].id;

            setSelectedRouteId(nextSelectedId);

            const bounds = new LngLatBounds();
            for (const option of result.routes) {
                for (const coordinate of option.route.geometry.coordinates) {
                    bounds.extend(coordinate);
                }
            }

            fitMapToRoute(bounds);
        } catch (error) {
            if (searchId !== activeSearchIdRef.current) return;
            console.error("Failed to calculate BreathWay route:", error);
            setRouteError(
                error instanceof Error
                    ? error.message
                    : "Unable to calculate the route."
            );
        } finally {
            if (searchId === activeSearchIdRef.current) {
                setRouteLoading(false);
            }
        }
    }

    async function handleSearchRoute(
        overrideMode?: ActivityMode,
        overrideLoop?: boolean,
        overrideDist?: number
    ) {
        const effMode = overrideMode ?? activityMode;
        const effLoop = overrideLoop ?? isLoopMode;
        const effDist = overrideDist ?? targetLoopDistanceKm;

        const origTrimmed = originText.trim();
        const destTrimmed = destinationText.trim();

        if (!origTrimmed) return;
        if (!effLoop && !destTrimmed) return;

        let nextOrigin = originCoordinates;
        let nextDest = destinationCoordinates;

        // If suggestion dropdowns are open, resolve to top choice
        if (originSuggestions.length > 0) {
            nextOrigin = originSuggestions[0].coordinates;
            setOriginCoordinates(nextOrigin);
            setOriginText(originSuggestions[0].title);
        } else if (origTrimmed.length >= 3 && origTrimmed !== "Central Delhi") {
            try {
                const freshOrigin = await searchPlaces(origTrimmed);
                if (freshOrigin.length > 0) {
                    nextOrigin = freshOrigin[0].coordinates;
                    setOriginCoordinates(nextOrigin);
                    setOriginText(freshOrigin[0].title);
                }
            } catch {
                // Keep fallback coordinates
            }
        }

        if (!effLoop) {
            if (destinationSuggestions.length > 0) {
                nextDest = destinationSuggestions[0].coordinates;
                setDestinationCoordinates(nextDest);
                setDestinationText(destinationSuggestions[0].title);
            } else if (destTrimmed.length >= 3 && destTrimmed !== "Delhi") {
                try {
                    const freshDest = await searchPlaces(destTrimmed);
                    if (freshDest.length > 0) {
                        nextDest = freshDest[0].coordinates;
                        setDestinationCoordinates(nextDest);
                        setDestinationText(freshDest[0].title);
                    }
                } catch {
                    // Keep fallback coordinates
                }
            }
        }

        setOriginSuggestions([]);
        setDestinationSuggestions([]);
        setOriginSearchActive(false);
        setDestinationSearchActive(false);
        setPlaceSearchError(null);

        void searchRoute(nextOrigin, effLoop ? nextOrigin : nextDest, {
            activityMode: effMode,
            loopMode: effLoop,
            loopDistanceKm: effDist,
        });
    }

    function changeActivityMode(mode: ActivityMode) {
        setActivityMode(mode);
        const nextLoop = mode === "driving" ? false : isLoopMode;
        if (mode === "driving" && isLoopMode) {
            setIsLoopMode(false);
        }
        if (routeData) {
            void searchRoute(
                originCoordinates,
                nextLoop ? originCoordinates : destinationCoordinates,
                {
                    activityMode: mode,
                    loopMode: nextLoop,
                    loopDistanceKm: targetLoopDistanceKm,
                }
            );
        }
    }

    function toggleLoopMode(loop: boolean) {
        setIsLoopMode(loop);
        if (routeData) {
            void searchRoute(
                originCoordinates,
                loop ? originCoordinates : destinationCoordinates,
                {
                    activityMode,
                    loopMode: loop,
                    loopDistanceKm: targetLoopDistanceKm,
                }
            );
        }
    }

    function changeLoopDistance(km: number) {
        setTargetLoopDistanceKm(km);
        if (routeData && isLoopMode) {
            void searchRoute(originCoordinates, originCoordinates, {
                activityMode,
                loopMode: true,
                loopDistanceKm: km,
            });
        }
    }

    // Update endpoint markers on the map
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !mapLoaded) return;

        endpointMarkersRef.current.forEach((marker) => marker.remove());
        endpointMarkersRef.current = [];

        if (isLoopMode) {
            // Workout Loop: Combined Start / Finish marker at origin
            const loopEl = document.createElement("div");
            loopEl.innerHTML = `
                <div style="
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 5px 12px;
                    border-radius: 9999px;
                    background-color: #059669;
                    color: #ffffff;
                    border: 2.5px solid #ffffff;
                    box-shadow: 0 4px 14px rgba(5, 150, 105, 0.45);
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 0.04em;
                    cursor: pointer;
                    user-select: none;
                ">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" />
                        <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />
                    </svg>
                    <span>START / FINISH</span>
                </div>
            `;
            const loopMarker = new Marker({
                element: loopEl,
                anchor: "center",
            })
                .setLngLat(originCoordinates)
                .addTo(map);

            endpointMarkersRef.current = [loopMarker];
        } else {
            // Origin marker (Emerald)
            const originEl = document.createElement("div");
            originEl.innerHTML = `
                <div style="
                    width: 28px;
                    height: 28px;
                    border-radius: 9999px;
                    background-color: #059669;
                    border: 3px solid #ffffff;
                    box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #ffffff;
                ">
                    <div style="width: 8px; height: 8px; border-radius: 9999px; background-color: #ffffff;"></div>
                </div>
            `;
            const originMarker = new Marker({
                element: originEl,
                anchor: "center",
            })
                .setLngLat(originCoordinates)
                .addTo(map);

            // Destination marker (Rose Red)
            const destEl = document.createElement("div");
            destEl.innerHTML = `
                <div style="
                    width: 28px;
                    height: 28px;
                    border-radius: 9999px;
                    background-color: #e11d48;
                    border: 3px solid #ffffff;
                    box-shadow: 0 4px 14px rgba(225, 29, 72, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #ffffff;
                ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 21c-4.97-4.97-8-8.5-8-12.5A8 8 0 1 1 20 8.5c0 4-3.03 7.53-8 12.5z"></path>
                    </svg>
                </div>
            `;
            const destMarker = new Marker({
                element: destEl,
                anchor: "center",
            })
                .setLngLat(destinationCoordinates)
                .addTo(map);

            endpointMarkersRef.current = [originMarker, destMarker];
        }
    }, [originCoordinates, destinationCoordinates, mapLoaded, isLoopMode]);

    // Update route styles on selection
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (
            !map ||
            !map.getLayer("breathway-route-outline") ||
            !map.getLayer("breathway-route-line")
        ) {
            return;
        }

        map.setPaintProperty("breathway-route-outline", "line-width", [
            "case",
            ["==", ["get", "routeId"], selectedRouteId],
            9,
            5,
        ]);

        map.setPaintProperty("breathway-route-line", "line-color", [
            "case",
            ["==", ["get", "routeId"], selectedRouteId],
            "#059669",
            "#94a3b8",
        ]);

        map.setPaintProperty("breathway-route-line", "line-width", [
            "case",
            ["==", ["get", "routeId"], selectedRouteId],
            5,
            3,
        ]);
    }, [selectedRouteId, mapLoaded]);

    // Update AQI markers for selected route
    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !mapLoaded || !selectedRoute) return;

        aqiMarkersRef.current.forEach((marker) => marker.remove());
        aqiMarkersRef.current = [];

        selectedRoute.airQuality.samples.forEach((sample, index) => {
            const marker = createAqiMarker(sample, index);
            marker.addTo(map);
            aqiMarkersRef.current.push(marker);
        });
    }, [selectedRoute, mapLoaded]);


    // Initial map setup
    useEffect(() => {
        const container = mapContainerRef.current;
        if (!container) return;

        if (!AWS_LOCATION_API_KEY) return;

        let disposed = false;

        const map: Map = new Map({
            container,
            style: MAP_STYLE,
            center: [77.209, 28.6139],
            zoom: 11,
        });

        mapInstanceRef.current = map;

        map.addControl(
            new NavigationControl({
                visualizePitch: true,
            }),
            "top-right"
        );

        map.on("error", (event) => {
            console.error("MapLibre error:", event.error);
        });

        map.on("load", async () => {
            if (disposed) return;

            map.resize();
            setMapLoaded(true);

            try {
                setRouteLoading(true);
                setRouteError(null);

                const result = await calculateRoute(ORIGIN, DESTINATION, {
                    activityMode: "running",
                    pollutionPreference: 0.7,
                    maxExtraTimePercent: 15,
                });

                if (disposed) return;

                const routesGeoJson = {
                    type: "FeatureCollection" as const,
                    features: result.routes.map((option) => ({
                        ...option.route,
                        properties: {
                            ...option.route.properties,
                            routeId: option.id,
                        },
                    })),
                };

                setRouteData(result);

                const initialSelectedId =
                    result.recommendation?.recommendedRouteId &&
                    result.routes.some(
                        (option) =>
                            option.id ===
                            result.recommendation?.recommendedRouteId
                    )
                        ? result.recommendation.recommendedRouteId
                        : result.routes[0].id;

                setSelectedRouteId(initialSelectedId);

                map.addSource("breathway-route", {
                    type: "geojson",
                    data: routesGeoJson,
                });

                setRouteSourceReady(true);

                map.addLayer({
                    id: "breathway-route-outline",
                    type: "line",
                    source: "breathway-route",
                    layout: {
                        "line-join": "round",
                        "line-cap": "round",
                    },
                    paint: {
                        "line-color": "#ffffff",
                        "line-width": [
                            "case",
                            ["==", ["get", "routeId"], initialSelectedId],
                            9,
                            5,
                        ],
                        "line-opacity": 0.95,
                    },
                });

                map.addLayer({
                    id: "breathway-route-line",
                    type: "line",
                    source: "breathway-route",
                    layout: {
                        "line-join": "round",
                        "line-cap": "round",
                    },
                    paint: {
                        "line-color": [
                            "case",
                            ["==", ["get", "routeId"], initialSelectedId],
                            "#059669",
                            "#94a3b8",
                        ],
                        "line-width": [
                            "case",
                            ["==", ["get", "routeId"], initialSelectedId],
                            5,
                            3,
                        ],
                        "line-opacity": 0.95,
                    },
                });

                const bounds = new LngLatBounds();
                for (const option of result.routes) {
                    for (const coordinate of option.route.geometry.coordinates) {
                        bounds.extend(coordinate);
                    }
                }

                const isMobile =
                    typeof window !== "undefined" && window.innerWidth < 640;
                map.fitBounds(bounds, {
                    padding: {
                        top: isMobile ? 80 : 90,
                        bottom: isMobile ? 80 : 80,
                        left: isMobile ? 24 : 440,
                        right: isMobile ? 24 : 70,
                    },
                    maxZoom: 15,
                    duration: 1000,
                });
            } catch (error) {
                if (disposed) return;
                console.error("Failed to load BreathWay route:", error);
                setRouteError(
                    error instanceof Error
                        ? error.message
                        : "Unable to load route information."
                );
            } finally {
                if (!disposed) {
                    setRouteLoading(false);
                }
            }
        });

        return () => {
            disposed = true;
            aqiMarkersRef.current.forEach((marker) => marker.remove());
            aqiMarkersRef.current = [];
            endpointMarkersRef.current.forEach((marker) => marker.remove());
            endpointMarkersRef.current = [];
            map.remove();
            if (mapInstanceRef.current === map) {
                mapInstanceRef.current = null;
            }
        };
    }, []);

    const selectedAverageAqi = selectedRoute?.airQuality.averageAqi ?? null;
    const selectedAqiMeta =
        selectedAverageAqi !== null ? getAqiColor(selectedAverageAqi) : null;
    const selectedDominant = selectedRoute
        ? getDominantPollutant(selectedRoute.airQuality.samples)
        : null;

    return (
        <div className="relative h-full w-full overflow-hidden bg-slate-900">
            {/* Map canvas */}
            <div
                ref={mapContainerRef}
                className="absolute inset-0 h-full w-full"
            />

            {/* Initial map loading splash */}
            {!mapLoaded && !mapError && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/20 bg-white/95 px-8 py-6 shadow-2xl backdrop-blur-md">
                        <div className="h-8 w-8 animate-spin rounded-full border-3 border-emerald-100 border-t-emerald-600" />
                        <div className="text-center">
                            <p className="text-sm font-bold text-slate-900">
                                BreathWay
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                                Connecting to live air-quality streams…
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Map error banner */}
            {mapError && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm">
                    <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
                        <div className="flex items-center gap-3 text-red-600">
                            <IconAlertCircle size={24} />
                            <h2 className="text-base font-bold text-slate-900">
                                Map service unavailable
                            </h2>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                            {mapError}
                        </p>
                    </div>
                </div>
            )}

            {/* Floating Top Controls / Toggle when panel is collapsed */}
            {mapLoaded && panelCollapsed && (
                <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPanelCollapsed(false)}
                        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur-md transition hover:bg-white hover:shadow-xl active:scale-95"
                    >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
                            <IconWind size={16} />
                        </div>
                        <div className="text-left">
                            <span className="block text-xs font-bold text-slate-900">
                                BreathWay Routes
                            </span>
                            <span className="block text-[11px] font-medium text-slate-500">
                                {routeData
                                    ? `${routeData.routes.length} options ready`
                                    : "Open route navigator"}
                            </span>
                        </div>
                        <IconChevronRight
                            size={16}
                            className="text-slate-400"
                        />
                    </button>
                </div>
            )}

            {/* Recenter button floating on the map */}
            {mapLoaded && routeData && (
                <button
                    type="button"
                    onClick={() => fitMapToRoute()}
                    title="Fit route to screen"
                    aria-label="Fit route to screen"
                    className="absolute bottom-6 right-14 z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-md backdrop-blur-md transition hover:bg-white hover:text-emerald-700 hover:shadow-lg active:scale-95"
                >
                    <IconFocus2 size={18} />
                </button>
            )}

            {/* Floating Mini CPCB Legend (Bottom-Right) */}
            {mapLoaded && (
                <div className="absolute bottom-6 left-4 z-10 hidden rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-lg backdrop-blur-md sm:block md:bottom-6 md:left-auto md:right-28">
                    <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-700">
                        <span className="text-[10px] uppercase tracking-wider text-slate-600">
                            CPCB AQI
                        </span>
                        <div className="flex items-center gap-1.5">
                            {CPCB_LEVELS.map((lvl) => (
                                <div
                                    key={lvl.label}
                                    className="flex items-center gap-1"
                                    title={`${lvl.label} (≤ ${lvl.max === Infinity ? "500+" : lvl.max}): ${lvl.desc}`}
                                >
                                    <span
                                        className="h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: lvl.color }}
                                    />
                                    <span className="text-[10px] text-slate-600">
                                        {lvl.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Main Navigation Console Drawer */}
            {mapLoaded && !panelCollapsed && (
                <aside className="custom-scrollbar absolute bottom-0 left-0 top-0 z-20 flex w-full flex-col border-r border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-md sm:bottom-4 sm:left-4 sm:top-4 sm:h-[calc(100%-2rem)] sm:w-[410px] sm:rounded-2xl sm:border">
                    {/* Brand Bar */}
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/30">
                                <IconWind size={20} stroke={2.2} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-base font-extrabold tracking-tight text-slate-900">
                                        BreathWay
                                    </h1>
                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                        Clean-Air Nav
                                    </span>
                                </div>
                                <p className="text-[11px] font-medium text-slate-500">
                                    Route for your lungs, not just your clock.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setPanelCollapsed(true)}
                            title="Collapse panel"
                            aria-label="Collapse navigation panel"
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                            <IconChevronLeft size={18} />
                        </button>
                    </div>

                    {/* Activity Mode Switcher Tabs */}
                    <div className="border-b border-slate-200/80 bg-slate-50/70 p-3.5 space-y-2.5">
                        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-200/80 p-1">
                            <button
                                type="button"
                                onClick={() => changeActivityMode("running")}
                                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                                    activityMode === "running"
                                        ? "bg-white text-emerald-800 shadow-xs"
                                        : "text-slate-600 hover:text-slate-900"
                                }`}
                            >
                                <IconRun
                                    size={15}
                                    className={
                                        activityMode === "running"
                                            ? "text-emerald-600"
                                            : "text-slate-500"
                                    }
                                />
                                <span>Running</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => changeActivityMode("cycling")}
                                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                                    activityMode === "cycling"
                                        ? "bg-white text-emerald-800 shadow-xs"
                                        : "text-slate-600 hover:text-slate-900"
                                }`}
                            >
                                <IconBike
                                    size={15}
                                    className={
                                        activityMode === "cycling"
                                            ? "text-emerald-600"
                                            : "text-slate-500"
                                    }
                                />
                                <span>Cycling</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => changeActivityMode("driving")}
                                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                                    activityMode === "driving"
                                        ? "bg-white text-emerald-800 shadow-xs"
                                        : "text-slate-600 hover:text-slate-900"
                                }`}
                            >
                                <IconCar
                                    size={15}
                                    className={
                                        activityMode === "driving"
                                            ? "text-emerald-600"
                                            : "text-slate-500"
                                    }
                                />
                                <span>Driving</span>
                            </button>
                        </div>

                        {/* Workout format selector (A ➔ B vs Workout Loop) */}
                        {activityMode !== "driving" && (
                            <div className="flex items-center justify-between pt-0.5">
                                <span className="text-[11px] font-semibold text-slate-600">
                                    Workout format
                                </span>
                                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold shadow-2xs">
                                    <button
                                        type="button"
                                        onClick={() => toggleLoopMode(false)}
                                        className={`rounded-md px-2.5 py-1 transition ${
                                            !isLoopMode
                                                ? "bg-slate-900 text-white font-bold"
                                                : "text-slate-600 hover:text-slate-900"
                                        }`}
                                    >
                                        Point to Point
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => toggleLoopMode(true)}
                                        className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition ${
                                            isLoopMode
                                                ? "bg-emerald-600 text-white font-bold"
                                                : "text-slate-600 hover:text-slate-900"
                                        }`}
                                    >
                                        <IconRotate size={12} stroke={2.5} />
                                        <span>Workout Loop</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Circuit distance chips */}
                        {activityMode !== "driving" && isLoopMode && (
                            <div className="pt-0.5">
                                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                                    <span className="font-semibold text-slate-600">
                                        Target circuit distance
                                    </span>
                                    <span className="font-mono font-bold text-emerald-700">
                                        {targetLoopDistanceKm} km
                                    </span>
                                </div>
                                <div className="grid grid-cols-6 gap-1">
                                    {[3, 5, 8, 10, 15, 21].map((km) => (
                                        <button
                                            key={km}
                                            type="button"
                                            onClick={() => changeLoopDistance(km)}
                                            className={`rounded-lg py-1 text-center font-mono text-[11px] font-bold transition ${
                                                targetLoopDistanceKm === km
                                                    ? "bg-emerald-600 text-white shadow-xs"
                                                    : "bg-white text-slate-700 border border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
                                            }`}
                                        >
                                            {km}k
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Scrollable Content */}
                    <div className="custom-scrollbar flex-1 overflow-y-auto px-5 py-4 space-y-5">
                        {/* Waypoint Search Section */}
                        <form
                            ref={searchFormRef}
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleSearchRoute();
                            }}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5"
                        >
                            <div className="relative flex flex-col gap-2.5">
                                {/* Origin Input */}
                                <div className="relative flex items-center">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                                        <div className="h-3 w-3 rounded-full border-2 border-white bg-emerald-600 shadow-sm" />
                                    </div>
                                    <input
                                        type="text"
                                        value={originText}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setOriginText(val);
                                            setOriginSearchActive(true);
                                            if (val.trim().length < 3) {
                                                setOriginSuggestions([]);
                                                setOriginSearching(false);
                                            }
                                        }}
                                        onFocus={() =>
                                            setOriginSearchActive(true)
                                        }
                                        aria-label={
                                            isLoopMode
                                                ? "Workout starting location"
                                                : "Starting location"
                                        }
                                        placeholder={
                                            isLoopMode
                                                ? "Workout start location"
                                                : "Starting location"
                                        }
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                                    />
                                    {originText && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOriginText("");
                                                setOriginSuggestions([]);
                                            }}
                                            className="absolute right-2.5 text-slate-400 hover:text-slate-600"
                                        >
                                            <IconX size={14} />
                                        </button>
                                    )}
                                </div>

                                {/* Point-to-Point Destination or Workout Loop Badge */}
                                {!isLoopMode ? (
                                    <>
                                        {/* Swap Waypoints Button */}
                                        <div className="relative flex items-center justify-end pr-3 -my-1.5 z-10">
                                            <button
                                                type="button"
                                                onClick={swapLocations}
                                                title="Swap start and destination"
                                                aria-label="Swap starting and destination locations"
                                                className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                                            >
                                                <IconArrowsExchange size={14} />
                                            </button>
                                        </div>

                                        {/* Destination Input */}
                                        <div className="relative flex items-center">
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center text-rose-600">
                                                <IconMapPin size={16} />
                                            </div>
                                            <input
                                                type="text"
                                                value={destinationText}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setDestinationText(val);
                                                    setDestinationSearchActive(true);
                                                    if (val.trim().length < 3) {
                                                        setDestinationSuggestions([]);
                                                        setDestinationSearching(false);
                                                    }
                                                }}
                                                onFocus={() =>
                                                    setDestinationSearchActive(true)
                                                }
                                                aria-label="Destination"
                                                placeholder="Destination"
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                                            />
                                            {destinationText && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDestinationText("");
                                                        setDestinationSuggestions([]);
                                                    }}
                                                    className="absolute right-2.5 text-slate-400 hover:text-slate-600"
                                                >
                                                    <IconX size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-950">
                                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                                            <IconRotate size={12} stroke={2.5} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-emerald-950">
                                                    {targetLoopDistanceKm} km Circuit Loop
                                                </span>
                                                <span className="text-[10px] font-bold text-emerald-700 font-mono">
                                                    Round-trip
                                                </span>
                                            </div>
                                            <span className="block text-[10px] text-emerald-800">
                                                Loops through cleanest air corridors back to start
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Origin Autocomplete Popover */}
                            {originSuggestions.length > 0 && (
                                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                                    {originSuggestions.map((place, index) => (
                                        <button
                                            key={`orig-${place.title}-${index}`}
                                            type="button"
                                            onMouseDown={(e) =>
                                                e.preventDefault()
                                            }
                                            onClick={() => selectOrigin(place)}
                                            className="flex w-full items-start gap-2.5 border-b border-slate-100 p-2.5 text-left last:border-b-0 hover:bg-emerald-50/60 transition"
                                        >
                                            <IconMapPin
                                                size={15}
                                                className="mt-0.5 shrink-0 text-emerald-600"
                                            />
                                            <div>
                                                <span className="block text-xs font-bold text-slate-900">
                                                    {place.title}
                                                </span>
                                                <span className="block text-[11px] text-slate-500">
                                                    {place.address}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Destination Autocomplete Popover */}
                            {!isLoopMode && destinationSuggestions.length > 0 && (
                                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                                    {destinationSuggestions.map(
                                        (place, index) => (
                                            <button
                                                key={`dest-${place.title}-${index}`}
                                                type="button"
                                                onMouseDown={(e) =>
                                                    e.preventDefault()
                                                }
                                                onClick={() =>
                                                    selectDestination(place)
                                                }
                                                className="flex w-full items-start gap-2.5 border-b border-slate-100 p-2.5 text-left last:border-b-0 hover:bg-emerald-50/60 transition"
                                            >
                                                <IconMapPin
                                                    size={15}
                                                    className="mt-0.5 shrink-0 text-rose-600"
                                                />
                                                <div>
                                                    <span className="block text-xs font-bold text-slate-900">
                                                        {place.title}
                                                    </span>
                                                    <span className="block text-[11px] text-slate-500">
                                                        {place.address}
                                                    </span>
                                                </div>
                                            </button>
                                        )
                                    )}
                                </div>
                            )}

                            {/* Place search feedback */}
                            {(originSearching || (!isLoopMode && destinationSearching)) && (
                                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
                                    <span>Searching locations…</span>
                                </div>
                            )}

                            {placeSearchError && (
                                <p
                                    role="alert"
                                    className="mt-2 text-xs text-rose-600"
                                >
                                    {placeSearchError}
                                </p>
                            )}

                            {/* Search Route Action Button */}
                            <button
                                type="submit"
                                disabled={
                                    routeLoading ||
                                    !originText.trim() ||
                                    (!isLoopMode && !destinationText.trim())
                                }
                                className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {routeLoading ? (
                                    <>
                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                        <span>Finding cleanest route…</span>
                                    </>
                                ) : (
                                    <>
                                        {isLoopMode ? (
                                            <IconRotate size={15} stroke={2.5} />
                                        ) : (
                                            <IconSearch size={15} stroke={2.5} />
                                        )}
                                        <span>
                                            {isLoopMode
                                                ? `Generate clean ${targetLoopDistanceKm} km loop`
                                                : "Search routes"}
                                        </span>
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Route Calculating Indicator */}
                        {routeLoading && (
                            <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-emerald-800">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700" />
                                <span className="text-xs font-medium">
                                    Sampling ambient AQI along corridors…
                                </span>
                            </div>
                        )}

                        {/* Route Calculation Error */}
                        {routeError && (
                            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
                                <div className="flex items-center gap-2">
                                    <IconAlertCircle size={16} />
                                    <span className="text-xs font-bold">
                                        Unable to calculate route
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-red-600">
                                    {routeError}
                                </p>
                            </div>
                        )}

                        {/* The Air Quality Hero Verdict Card */}
                        {routeData && recommendedRoute && (
                            <div className="relative overflow-hidden rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/90 via-white to-slate-50 p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600 text-white">
                                            <IconShieldCheck size={15} />
                                        </div>
                                        <span className="text-xs font-bold text-emerald-950">
                                            Recommended Clean Route
                                        </span>
                                    </div>
                                    {recommendedAverageAqi !== null && (
                                        <span className="rounded-md bg-white px-2 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200 shadow-2xs">
                                            Avg AQI {recommendedAverageAqi}
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3">
                                    {aqiDifference !== null &&
                                    aqiDifference > 0 ? (
                                        <div>
                                            <div className="flex items-baseline gap-1.5">
                                                <span className="text-2xl font-black tracking-tight text-emerald-700 font-mono">
                                                    -{aqiDifference}
                                                </span>
                                                <span className="text-xs font-bold text-slate-700">
                                                    AQI points cleaner
                                                </span>
                                            </div>
                                            <p className="mt-1 text-xs leading-5 text-slate-600">
                                                {extraTravelMinutes === 0
                                                    ? "Equal workout time with significantly cleaner air."
                                                    : `Adds only ${extraTravelMinutes} min to steer clear of heavy particulate traffic.`}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-xs leading-5 text-slate-600">
                                            The fastest route also offers the
                                            cleanest air along your corridor.
                                        </p>
                                    )}

                                    {inhaledDoseDifference !== null && inhaledDoseDifference > 0 && (
                                        <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-100/90 p-2.5 text-emerald-950 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-900">
                                                    <IconSmokingNo size={16} className="shrink-0 text-emerald-700" />
                                                    <span>
                                                        {sparedCigarettes && sparedCigarettes > 0
                                                            ? `~${sparedCigarettes} Cigarettes Spared`
                                                            : `~${(inhaledDoseDifference / 330).toFixed(1)} Cigarettes Spared`}
                                                    </span>
                                                </div>
                                                {sparedDosePercent > 0 && (
                                                    <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white font-mono shadow-2xs">
                                                        -{sparedDosePercent}% Smog
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] font-medium leading-tight text-emerald-900/90">
                                                Avoids <span className="font-mono font-extrabold text-emerald-950">~{inhaledDoseDifference} µg</span> particulate lung burden vs. the fastest corridor.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Clean comparison metrics */}
                                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-100/80 pt-3">
                                    <div className="flex items-center gap-2">
                                        <IconClock
                                            size={15}
                                            className="text-slate-400 shrink-0"
                                        />
                                        <div>
                                            <span className="block text-[10px] text-slate-500">
                                                {activityMode === "running" ? "Time / Pace" : activityMode === "cycling" ? "Time / Speed" : "Travel time"}
                                            </span>
                                            <div className="flex items-baseline gap-1 font-mono">
                                                <span className="text-xs font-bold text-slate-900">
                                                    {formatDuration(
                                                        recommendedRoute.route
                                                            .properties
                                                            .durationSeconds
                                                    )}
                                                </span>
                                                {activityMode !== "driving" && (
                                                    <span className="text-[10px] font-semibold text-emerald-800">
                                                        ({formatAthleticPace(
                                                            recommendedRoute.route.properties.distanceMeters,
                                                            recommendedRoute.route.properties.durationSeconds,
                                                            activityMode
                                                        )})
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <IconRoute
                                            size={15}
                                            className="text-slate-400 shrink-0"
                                        />
                                        <div>
                                            <span className="block text-[10px] text-slate-500">
                                                Distance
                                            </span>
                                            <span className="text-xs font-bold text-slate-900 font-mono">
                                                {formatDistance(
                                                    recommendedRoute.route
                                                        .properties
                                                        .distanceMeters
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {recommendedInhaledDose !== null && (
                                    <div className="mt-2 flex items-center justify-between rounded-lg bg-white/80 px-2.5 py-1.5 text-[11px] border border-emerald-100">
                                        <span className="text-slate-600 font-medium">Estimated lung PM2.5 load:</span>
                                        <div className="flex items-center gap-1.5 font-mono">
                                            <span className="font-bold text-emerald-950">~{recommendedInhaledDose} µg</span>
                                            {recommendedCigarettes !== null && (
                                                <span className="rounded bg-amber-50 px-1.5 py-0.2 text-[10px] font-bold text-amber-900 border border-amber-200/60">
                                                    ≈ {formatCigaretteEquivalent(recommendedCigarettes)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={() => setHealthShieldOpen(true)}
                                    className="mt-3 flex w-full items-center justify-between rounded-xl border border-emerald-300 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-500/20 active:scale-[0.99]"
                                >
                                    <div className="flex items-center gap-2">
                                        <IconHeartbeat size={16} className="text-emerald-700 shrink-0" />
                                        <span>Workout Health Shield Breakdown</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                        <span>View</span>
                                        <IconChevronRight size={14} />
                                    </div>
                                </button>

                                <div className="mt-2.5 grid grid-cols-2 gap-2">
                                    <a
                                        href={generateGoogleMapsUrl(recommendedRoute.route, activityMode)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-bold text-white shadow-xs transition hover:bg-slate-800 active:scale-[0.98]"
                                    >
                                        <IconBrandGoogleMaps size={15} className="text-emerald-400 shrink-0" />
                                        <span>Google Maps</span>
                                        <IconExternalLink size={12} className="text-slate-400" />
                                    </a>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            downloadRouteGpx(
                                                recommendedRoute.route,
                                                `breathway-${activityMode}-clean-route`
                                            )
                                        }
                                        title="Download standard GPS file for Garmin, Apple Watch, or Strava"
                                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
                                    >
                                        <IconDownload size={14} className="text-slate-500 shrink-0" />
                                        <span>Export GPX</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Route Comparison Selector */}
                        {routeData && (
                            <div>
                                <div className="mb-2.5 flex items-center justify-between">
                                    <h2 className="text-xs font-bold text-slate-900">
                                        Route Options
                                    </h2>
                                    <span className="text-[11px] font-medium text-slate-500">
                                        {routeData.routes.length} paths analyzed
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    {routeData.routes.map((option, index) => {
                                        const isSelected =
                                            option.id === selectedRouteId;
                                        const avgAqi =
                                            option.airQuality.averageAqi;
                                        const isCleanest =
                                            option.id === cleanestRouteId;
                                        const isRecommended =
                                            option.id === recommendedRouteId;
                                        const aqiColor =
                                            avgAqi !== null
                                                ? getAqiColor(avgAqi)
                                                : null;
                                        const optionDose = estimateInhaledDose(
                                            avgAqi,
                                            option.route.properties.durationSeconds,
                                            activityMode
                                        );
                                        const optionPace = formatAthleticPace(
                                            option.route.properties.distanceMeters,
                                            option.route.properties.durationSeconds,
                                            activityMode
                                        );

                                        return (
                                            <button
                                                key={option.id}
                                                type="button"
                                                onClick={() =>
                                                    setSelectedRouteId(
                                                        option.id
                                                    )
                                                }
                                                aria-pressed={isSelected}
                                                className={`w-full rounded-xl border p-3 text-left transition ${
                                                    isSelected
                                                        ? "border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-600 shadow-xs"
                                                        : "border-slate-200 bg-white hover:border-slate-300"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${
                                                                isSelected
                                                                    ? "bg-emerald-600 text-white"
                                                                    : "bg-slate-100 text-slate-600"
                                                            }`}
                                                        >
                                                            {index + 1}
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-900">
                                                            Route {index + 1}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-1.5">
                                                        {isRecommended && (
                                                            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                                                Recommended
                                                            </span>
                                                        )}
                                                        {isCleanest &&
                                                            !isRecommended && (
                                                                <span className="rounded-md bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                                                                    Lowest AQI
                                                                </span>
                                                            )}
                                                    </div>
                                                </div>

                                                <div className="mt-2.5 grid grid-cols-3 gap-2">
                                                    <div>
                                                        <span className="block text-[10px] text-slate-500">
                                                            {activityMode === "running" ? "Time / Pace" : activityMode === "cycling" ? "Time / Speed" : "Duration"}
                                                        </span>
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-bold text-slate-900 font-mono">
                                                                {formatDuration(
                                                                    option.route
                                                                        .properties
                                                                        .durationSeconds
                                                                )}
                                                            </span>
                                                            {activityMode !== "driving" && (
                                                                <span className="text-[10px] font-semibold text-slate-500 font-mono">
                                                                    {optionPace}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <span className="block text-[10px] text-slate-500">
                                                            Distance
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-900 font-mono">
                                                            {formatDistance(
                                                                option.route
                                                                    .properties
                                                                    .distanceMeters
                                                                )}
                                                        </span>
                                                        {optionDose !== null && (
                                                            <div className="mt-0.5 flex flex-col">
                                                                <span className="block text-[10px] font-semibold text-slate-500 font-mono">
                                                                    ~{optionDose} µg PM2.5
                                                                </span>
                                                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-800 font-mono">
                                                                    <IconSmoking size={11} className="shrink-0 text-amber-600" />
                                                                    {formatCigaretteEquivalent(estimateCigaretteEquivalent(optionDose))}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div>
                                                        <span className="block text-[10px] text-slate-500">
                                                            Avg AQI
                                                        </span>
                                                        {aqiColor ? (
                                                            <div className="flex items-center gap-1">
                                                                <span
                                                                    className="h-2 w-2 rounded-full"
                                                                    style={{
                                                                        backgroundColor:
                                                                            aqiColor.color,
                                                                    }}
                                                                />
                                                                <span
                                                                    className="text-xs font-bold font-mono"
                                                                    style={{
                                                                        color: aqiColor.textColor,
                                                                    }}
                                                                >
                                                                    {avgAqi}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-slate-400">
                                                                —
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Routing Preferences Accordion */}
                        {routeData && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setPreferencesExpanded(!preferencesExpanded)
                                    }
                                    className="flex w-full items-center justify-between text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        <IconAdjustmentsHorizontal
                                            size={16}
                                            className="text-slate-500"
                                        />
                                        <span className="text-xs font-bold text-slate-900">
                                            Routing Preferences
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-slate-400">
                                        <span className="text-[11px] text-slate-500">
                                            +{maxExtraTimePercent}% time
                                        </span>
                                        {preferencesExpanded ? (
                                            <IconChevronUp size={15} />
                                        ) : (
                                            <IconChevronDown size={15} />
                                        )}
                                    </div>
                                </button>

                                {preferencesExpanded && (
                                    <div className="mt-3.5 space-y-4 border-t border-slate-200/70 pt-3.5">
                                        {/* Air Priority Slider */}
                                        <div>
                                            <div className="flex justify-between text-xs font-semibold text-slate-800">
                                                <span>Air quality priority</span>
                                                <span className="font-mono text-emerald-700">
                                                    {Math.round(
                                                        pollutionPreference *
                                                            100
                                                    )}
                                                    %
                                                </span>
                                            </div>
                                            <input
                                                type="range"
                                                min={0}
                                                max={1}
                                                step={0.1}
                                                value={pollutionPreference}
                                                onChange={(e) =>
                                                    setPollutionPreference(
                                                        Number(e.target.value)
                                                    )
                                                }
                                                className="mt-2 w-full cursor-pointer accent-emerald-600"
                                            />
                                            <div className="flex justify-between text-[10px] text-slate-500">
                                                <span>Fastest route</span>
                                                <span>Cleanest air</span>
                                            </div>
                                        </div>

                                        {/* Extra Travel Time Allowance */}
                                        <div>
                                            <div className="flex justify-between text-xs font-semibold text-slate-800">
                                                <span>
                                                    Max extra commute time
                                                </span>
                                                <span className="font-mono text-emerald-700">
                                                    +{maxExtraTimePercent}%
                                                </span>
                                            </div>
                                            <input
                                                type="range"
                                                min={0}
                                                max={30}
                                                step={5}
                                                value={maxExtraTimePercent}
                                                onChange={(e) =>
                                                    setMaxExtraTimePercent(
                                                        Number(e.target.value)
                                                    )
                                                }
                                                className="mt-2 w-full cursor-pointer accent-emerald-600"
                                            />
                                            <div className="flex justify-between text-[10px] text-slate-500">
                                                <span>Fastest only (+0%)</span>
                                                <span>Up to +30% longer</span>
                                            </div>
                                            <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
                                                {eligibleRouteCount}{" "}
                                                {eligibleRouteCount === 1
                                                    ? "route meets"
                                                    : "routes meet"}{" "}
                                                your travel time limit.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                void searchRoute(
                                                    originCoordinates,
                                                    isLoopMode ? originCoordinates : destinationCoordinates,
                                                    {
                                                        activityMode,
                                                        loopMode: isLoopMode,
                                                        loopDistanceKm: targetLoopDistanceKm,
                                                        pollutionPreference,
                                                        maxExtraTimePercent,
                                                    }
                                                );
                                            }}
                                            disabled={routeLoading}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-60"
                                        >
                                            <IconRefresh
                                                size={14}
                                                className={
                                                    routeLoading
                                                        ? "animate-spin"
                                                        : ""
                                                }
                                            />
                                            <span>
                                                {routeLoading
                                                    ? "Updating routes…"
                                                    : "Apply preferences"}
                                            </span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Selected Route Air Quality Profile */}
                        {selectedRoute && (
                            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-bold text-slate-900">
                                        Selected Route Air Profile
                                    </h3>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                        CPCB India
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div className="rounded-lg bg-slate-50 p-2.5">
                                        <span className="block text-[10px] text-slate-500">
                                            Average AQI
                                        </span>
                                        <div className="mt-1 flex items-baseline gap-1.5">
                                            <span
                                                className="text-xl font-black font-mono"
                                                style={{
                                                    color:
                                                        selectedAqiMeta?.color ??
                                                        "#0f172a",
                                                }}
                                            >
                                                {selectedAverageAqi ?? "—"}
                                            </span>
                                            <span className="text-[11px] font-semibold text-slate-600">
                                                {selectedAqiMeta?.label ??
                                                    "No data"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="rounded-lg bg-slate-50 p-2.5">
                                        <span className="block text-[10px] text-slate-500">
                                            Peak AQI
                                        </span>
                                        <div className="mt-1 flex items-baseline gap-1.5">
                                            <span className="text-xl font-black text-slate-900 font-mono">
                                                {selectedRoute.airQuality
                                                    .maxAqi ?? "—"}
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                sampled
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {selectedDominant && (
                                    <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-slate-500">
                                                Dominant pollutant
                                            </span>
                                            <span className="font-bold text-slate-900">
                                                {selectedDominant}
                                            </span>
                                        </div>
                                        {POLLUTANT_INFO[selectedDominant] && (
                                            <p className="mt-1 text-[11px] leading-4 text-slate-600">
                                                {POLLUTANT_INFO[selectedDominant]}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* CPCB Scale Gauge */}
                                <div>
                                    <p className="mb-1.5 text-[10px] font-semibold text-slate-600">
                                        CPCB benchmark spectrum
                                    </p>
                                    <div className="flex h-2 w-full overflow-hidden rounded-full">
                                        {CPCB_LEVELS.map((lvl) => (
                                            <div
                                                key={lvl.label}
                                                className="h-full flex-1"
                                                style={{
                                                    backgroundColor: lvl.color,
                                                }}
                                                title={lvl.label}
                                            />
                                        ))}
                                    </div>
                                    <div className="mt-1 flex justify-between text-[9px] text-slate-600 font-mono">
                                        <span>0 (Good)</span>
                                        <span>200</span>
                                        <span>400+ (Severe)</span>
                                    </div>
                                </div>

                                {/* Athletic Ventilation & Inhaled PM2.5 Load */}
                                <div className="rounded-lg bg-emerald-50/70 p-2.5 text-xs border border-emerald-100/90 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-emerald-800 font-semibold">
                                            Minute Lung Ventilation
                                        </span>
                                        <span className="font-mono font-bold text-emerald-950">
                                            {VENTILATION_RATES[activityMode]} L/min
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between border-t border-emerald-200/60 pt-1 text-[11px]">
                                        <span className="text-slate-600">
                                            Estimated Inhaled PM2.5:
                                        </span>
                                        <span className="font-mono font-bold text-emerald-900">
                                            ~{estimateInhaledDose(
                                                selectedAverageAqi,
                                                selectedRoute.route.properties
                                                    .durationSeconds,
                                                activityMode
                                            ) ?? "—"}{" "}
                                            µg
                                        </span>
                                    </div>
                                    <p className="text-[10px] leading-3.5 text-slate-500">
                                        {activityMode === "running"
                                            ? "Aerobic running increases minute respiratory exchange ~6.5x over resting volume."
                                            : activityMode === "cycling"
                                            ? "Sustained cycling increases minute respiratory exchange ~4.5x over resting volume."
                                            : "In-vehicle transit maintains resting respiratory baseline (~10 L/min)."}
                                    </p>
                                </div>

                                <p className="text-[10px] leading-4 text-slate-600">
                                    AQI reflects sampled regional monitors along
                                    corridors. Inhaled dose is calculated from
                                    athletic minute ventilation and exposure duration.
                                </p>
                            </div>
                        )}
                    </div>
                </aside>
            )}

            {/* Workout Health Shield Modal */}
            {healthShieldOpen && recommendedRoute && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="health-shield-title"
                    onClick={() => setHealthShieldOpen(false)}
                >
                    <div
                        className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                                    <IconHeartbeat size={20} />
                                </div>
                                <div>
                                    <h3 id="health-shield-title" className="text-sm font-bold text-slate-900">
                                        Workout Health Shield
                                    </h3>
                                    <p className="text-[11px] text-slate-500">
                                        Berkeley Earth Cigarette Equivalence & Lung Burden
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setHealthShieldOpen(false)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                                aria-label="Close modal"
                            >
                                <IconX size={18} />
                            </button>
                        </div>

                        {/* Modal Body - Scrollable */}
                        <div className="custom-scrollbar overflow-y-auto p-5 space-y-4 text-slate-700">
                            {/* Shield Hero Highlights */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold text-emerald-800">
                                            Cigarettes Spared
                                        </span>
                                        <IconSmokingNo size={18} className="text-emerald-700" />
                                    </div>
                                    <div className="mt-2 flex items-baseline gap-1">
                                        <span className="text-2xl font-black font-mono text-emerald-950">
                                            {sparedCigarettes && sparedCigarettes > 0 ? `~${sparedCigarettes}` : "0.0"}
                                        </span>
                                        <span className="text-xs font-semibold text-emerald-800">
                                            cigs
                                        </span>
                                    </div>
                                    <span className="mt-1 block text-[10px] text-emerald-700 font-medium leading-tight">
                                        {sparedDosePercent > 0 ? `-${sparedDosePercent}% lung toxic burden` : "Baseline clean air corridor"}
                                    </span>
                                </div>

                                <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-3.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold text-teal-800">
                                            Deep PM2.5 Spared
                                        </span>
                                        <IconSparkles size={18} className="text-teal-700" />
                                    </div>
                                    <div className="mt-2 flex items-baseline gap-1">
                                        <span className="text-2xl font-black font-mono text-teal-950">
                                            {inhaledDoseDifference && inhaledDoseDifference > 0 ? `~${inhaledDoseDifference}` : "0"}
                                        </span>
                                        <span className="text-xs font-semibold text-teal-800">
                                            µg
                                        </span>
                                    </div>
                                    <span className="mt-1 block text-[10px] text-teal-700 font-medium leading-tight">
                                        Particulate kept out of alveoli
                                    </span>
                                </div>
                            </div>

                            {/* Route Comparison Bar Breakdown */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                                <h4 className="text-xs font-bold text-slate-900">
                                    Physiological Exposure Comparison
                                </h4>

                                {/* Recommended Route */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-emerald-950 flex items-center gap-1.5">
                                            <span className="h-2 w-2 rounded-full bg-emerald-600" />
                                            Recommended Clean Route
                                        </span>
                                        <div className="flex items-center gap-2 font-mono">
                                            <span className="font-bold text-slate-800">
                                                ~{recommendedInhaledDose ?? "—"} µg
                                            </span>
                                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                                {formatCigaretteEquivalent(recommendedCigarettes)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                                            style={{
                                                width: `${
                                                    fastestInhaledDose && fastestInhaledDose > 0 && recommendedInhaledDose !== null
                                                        ? Math.min(100, Math.max(12, Math.round((recommendedInhaledDose / fastestInhaledDose) * 100)))
                                                        : 100
                                                }%`,
                                            }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                                        <span>Avg AQI {recommendedAverageAqi ?? "—"}</span>
                                        <span>
                                            {formatDuration(recommendedDuration)}
                                            {activityMode !== "driving" && ` (${formatAthleticPace(recommendedRoute.route.properties.distanceMeters, recommendedDuration, activityMode)})`}
                                        </span>
                                    </div>
                                </div>

                                {/* Fastest Route (if distinct) */}
                                {fastestRoute && fastestRoute.id !== recommendedRoute.id && (
                                    <div className="space-y-1.5 pt-2.5 border-t border-slate-200/80">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                                Fastest Route (Standard Roadways)
                                            </span>
                                            <div className="flex items-center gap-2 font-mono">
                                                <span className="font-bold text-slate-800">
                                                    ~{fastestInhaledDose ?? "—"} µg
                                                </span>
                                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                                    {formatCigaretteEquivalent(fastestCigarettes)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                                                style={{ width: "100%" }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                                            <span>Avg AQI {fastestAverageAqi ?? "—"}</span>
                                            <span>{formatDuration(fastestDuration)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Scientific & Ventilation Formula Breakdown */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-xs space-y-2">
                                <div className="flex items-center gap-2 font-bold text-slate-800">
                                    <IconFlame size={15} className="text-amber-600" />
                                    <span>The Berkeley Earth Cigarette Metric</span>
                                </div>
                                <p className="text-[11px] leading-relaxed text-slate-600">
                                    According to epidemiological research by Muller & Rohde (Berkeley Earth), inhaling 22 µg/m³ of ambient PM2.5 continuously over 24 hours corresponds to approximately <strong className="text-slate-800">1 cigarette per day</strong> (~330 µg inhaled particulate mass).
                                </p>
                                <div className="rounded-lg bg-white p-2.5 border border-slate-200/80 text-[11px] leading-relaxed text-slate-600">
                                    <span className="font-semibold text-slate-800">Why outdoor workouts demand clean routes:</span>
                                    {" "}Athletic breathing rates ({VENTILATION_RATES[activityMode]} L/min for {activityMode}) exchange air at 4.5x–6.5x resting volume. In heavy traffic corridors, elevated minute ventilation pulls ultrafine PM2.5 past bronchial cilia directly into alveolar capillary beds. BreathWay finds clean micro-corridors so you get the cardio benefits without the toxic particulate burden.
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-t border-slate-100 bg-slate-50/80 px-5 py-3.5">
                            <div className="flex flex-wrap items-center gap-2">
                                <a
                                    href={generateGoogleMapsUrl(recommendedRoute.route, activityMode)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-slate-800 active:scale-[0.98]"
                                >
                                    <IconBrandGoogleMaps size={16} className="text-emerald-400 shrink-0" />
                                    <span>Google Maps</span>
                                    <IconExternalLink size={12} className="text-slate-400" />
                                </a>

                                <button
                                    type="button"
                                    onClick={() =>
                                        downloadRouteGpx(
                                            recommendedRoute.route,
                                            `breathway-${activityMode}-clean-route`
                                        )
                                    }
                                    title="Download standard GPS file for Garmin, Apple Watch, or Strava"
                                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.98]"
                                >
                                    <IconDownload size={15} className="text-slate-500" />
                                    <span>GPX</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={copyHealthShieldSummary}
                                    className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition active:scale-[0.98]"
                                >
                                    {copiedSummary ? (
                                        <>
                                            <IconCheck size={15} className="text-emerald-700" />
                                            <span>Copied!</span>
                                        </>
                                    ) : (
                                        <>
                                            <IconShare size={15} className="text-emerald-700" />
                                            <span>Share / Copy</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => setHealthShieldOpen(false)}
                                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
