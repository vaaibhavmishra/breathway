import assert from "node:assert/strict";
import { scoreRoutes, type ScorableRoute } from "./route-scoring";

const routes: ScorableRoute[] = [
    {
        id: "route-a",
        route: {
            properties: {
                distanceMeters: 10_000,
                durationSeconds: 1_500,
            },
        },
        airQuality: {
            status: "available",
            indexCode: "ind_cpcb",
            sampleCount: 4,
            availableSampleCount: 4,
            averageAqi: 150,
            maxAqi: 170,
        },
    },
    {
        id: "route-b",
        route: {
            properties: {
                distanceMeters: 10_500,
                durationSeconds: 1_680,
            },
        },
        airQuality: {
            status: "available",
            indexCode: "ind_cpcb",
            sampleCount: 4,
            availableSampleCount: 4,
            averageAqi: 105,
            maxAqi: 120,
        },
    },
    {
        id: "route-c",
        route: {
            properties: {
                distanceMeters: 12_000,
                durationSeconds: 2_200,
            },
        },
        airQuality: {
            status: "available",
            indexCode: "ind_cpcb",
            sampleCount: 4,
            availableSampleCount: 4,
            averageAqi: 75,
            maxAqi: 90,
        },
    },
];

// Test 1: Cleaner route wins within the time limit.
const result = scoreRoutes(routes);

assert.equal(result.status, "recommended");
assert.equal(result.fastestRouteId, "route-a");
assert.equal(result.recommendedRouteId, "route-b");

console.log("✅ Test 1 passed: balanced cleaner route recommended");

// Test 2: The slowest route must be excluded by the time limit.
const routeC = result.routes.find(
    (route) => route.id === "route-c"
);

assert.ok(routeC);
assert.equal(routeC.eligibleByTime, false);
assert.equal(routeC.recommendationEligible, false);

console.log("✅ Test 2 passed: route exceeding time limit excluded");

// Test 3: Insufficient AQI data must trigger a fallback.
const routesWithoutReliableAqi: ScorableRoute[] = [
    {
        ...routes[0],
        airQuality: {
            status: "unavailable",
            indexCode: null,
            sampleCount: 4,
            availableSampleCount: 0,
            averageAqi: null,
            maxAqi: null,
        },
    },
    {
        ...routes[1],
        airQuality: {
            status: "available",
            indexCode: "ind_cpcb",
            sampleCount: 4,
            availableSampleCount: 1,
            averageAqi: 80,
            maxAqi: 80,
        },
    },
];

const fallbackResult = scoreRoutes(
    routesWithoutReliableAqi
);

assert.equal(fallbackResult.status, "fastest_fallback");
assert.equal(fallbackResult.recommendedRouteId, "route-a");

console.log("✅ Test 3 passed: insufficient AQI uses fastest-route fallback");

// Test 4: Empty input must not crash.
const emptyResult = scoreRoutes([]);

assert.equal(emptyResult.status, "unavailable");
assert.equal(emptyResult.recommendedRouteId, null);
assert.equal(emptyResult.routes.length, 0);

console.log("✅ Test 4 passed: empty route list handled correctly");

// Test 5: Invalid preference must be rejected.
assert.throws(
    () =>
        scoreRoutes(routes, {
            pollutionPreference: 1.5,
        }),
    /pollutionPreference/
);

console.log("✅ Test 5 passed: invalid scoring preference rejected");

console.log("\n🎉 All route-scoring tests passed!");