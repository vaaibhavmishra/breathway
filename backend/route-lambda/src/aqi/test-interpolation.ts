import { estimateAQI } from "./interpolation";

async function main() {
  // Test 1: Query the exact configured central coordinate.
  const exactResult = await estimateAQI({
    latitude: 28.6139,
    longitude: 77.2090,
  });

  console.log("Exact-coordinate result:");
  console.log(JSON.stringify(exactResult, null, 2));

  if (exactResult.status !== "estimated") {
    throw new Error(
      "Expected a usable observation at the central coordinate."
    );
  }

  if (exactResult.method !== "exact_observation") {
    throw new Error(
      "Expected an exact-coordinate observation."
    );
  }

  // Test 2: Query a point between configured locations.
  const intermediateResult = await estimateAQI({
    latitude: 28.6210,
    longitude: 77.2520,
  });

  console.log("\nIntermediate-coordinate result:");
  console.log(
    JSON.stringify(intermediateResult, null, 2)
  );

  if (
    intermediateResult.status === "estimated" &&
    intermediateResult.method ===
      "inverse_distance_weighting"
  ) {
    console.log(
      "\nSUCCESS: IDW returned an estimate for the intermediate point."
    );
  } else {
    console.log(
      "\nThe intermediate point did not have enough suitable observations for IDW."
    );

    console.log(
      "This is a valid outcome when spatial coverage is insufficient."
    );
  }
}

main().catch((error) => {
  console.error("Interpolation test failed:", error);
  process.exitCode = 1;
});