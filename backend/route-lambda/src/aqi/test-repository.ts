import {
  saveObservation,
  getNearbyObservations,
} from "./repository";

async function main() {
  const coordinates = {
    latitude: 28.6139,
    longitude: 77.2090,
  };

  const locationId = `manual-test-${Date.now()}`;

  console.log("Saving test observation...");

  const saved = await saveObservation({
    ...coordinates,
    locationId,
    aqi: 142,
    dominantPollutant: "PM2.5",
    source: "manual_test",
    observedAt: new Date().toISOString(),
  });

  console.log("Saved observation:");
  console.log({
    PK: saved.PK,
    SK: saved.SK,
    aqi: saved.aqi,
    geohash: saved.geohash,
    expiresAt: saved.expiresAt,
  });

  console.log("\nQuerying nearby observations...");

  const observations = await getNearbyObservations(
    coordinates
  );

  const found = observations.find(
    (observation) =>
      observation.locationId === locationId
  );

  if (!found) {
    throw new Error(
      "Test observation was saved but not returned by the nearby query."
    );
  }

  console.log("\nSUCCESS: DynamoDB write and query both work.");
  console.log({
    locationId: found.locationId,
    aqi: found.aqi,
    observedAt: found.observedAt,
  });
}

main().catch((error) => {
  console.error("\nAQI repository test failed:");
  console.error(error);
  process.exitCode = 1;
});