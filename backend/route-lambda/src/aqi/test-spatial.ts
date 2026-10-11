import { findNearbyObservations } from "./spatial";

async function main() {
  const testCoordinates = {
    latitude: 28.6139,
    longitude: 77.2090,
  };

  console.log("Testing spatial lookup...");

  const result = await findNearbyObservations(
    testCoordinates,
    {
      maxDistanceMeters: 5_000,
      maxAgeMs: 60 * 60 * 1000,
      minObservations: 1,
    }
  );

  console.log(
    JSON.stringify(
      {
        status: result.status,
        candidateCount: result.candidateCount,
        nearbyObservationCount:
          result.observations.length,
        observations: result.observations.map(
          ({ observation, distanceMeters }) => ({
            locationId: observation.locationId,
            aqi: observation.aqi,
            distanceMeters: Math.round(
              distanceMeters
            ),
            observedAt: observation.observedAt,
          })
        ),
      },
      null,
      2
    )
  );

  if (result.candidateCount === 0) {
    throw new Error(
      "No observations were retrieved. Check the table, Region, and timestamps."
    );
  }

  if (result.observations.length === 0) {
    console.warn(
      "Observations were retrieved, but none passed the distance and freshness filters."
    );
  } else {
    console.log(
      "SUCCESS: Nearby observations were found."
    );
  }
}

main().catch((error) => {
  console.error("Spatial lookup test failed:", error);
  process.exitCode = 1;
});