import {
    DynamoDBClient,
} from "@aws-sdk/client-dynamodb";

import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import ngeohash = require("ngeohash");

import {
    GEOHASH_PRECISION,
    MAX_OBSERVATION_AGE_MS,
    OBSERVATION_RETENTION_SECONDS,
    isValidAQI,
    isValidCoordinates,
    type AQIObservation,
    type AQIObservationInput,
    type Coordinates,
} from "./types";

const TABLE_NAME = process.env.AQI_TABLE_NAME;

if (!TABLE_NAME) {
    throw new Error(
        "AQI_TABLE_NAME environment variable is not configured."
    );
}

const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "ap-southeast-2",
});

const documentClient = DynamoDBDocumentClient.from(
    dynamoClient,
    {
        marshallOptions: {
            removeUndefinedValues: true,
        },
    }
);

const MAX_ITEMS_PER_CELL = 50;

function getGeohash(
    coordinates: Coordinates
): string {
    return ngeohash.encode(
        coordinates.latitude,
        coordinates.longitude,
        GEOHASH_PRECISION
    );
}

function getObservationKey(
    observedAt: string,
    locationId: string
): string {
    return `OBS#${observedAt}#${locationId}`;
}

/**
 * Validates and saves one AQI observation.
 *
 * Repeating the same write with the same locationId and
 * observedAt produces the same DynamoDB key.
 */
export async function saveObservation(
    input: AQIObservationInput
): Promise<AQIObservation> {
    if (!isValidCoordinates(input)) {
        throw new Error("Invalid observation coordinates.");
    }

    if (!isValidAQI(input.aqi)) {
        throw new Error("AQI must be a finite, non-negative number.");
    }

    if (
        typeof input.locationId !== "string" ||
        !input.locationId.trim()
    ) {
        throw new Error("locationId is required.");
    }

    if (
        typeof input.source !== "string" ||
        !input.source.trim()
    ) {
        throw new Error("source is required.");
    }

    const parsedObservedAt = new Date(input.observedAt);

    if (
        !input.observedAt ||
        Number.isNaN(parsedObservedAt.getTime())
    ) {
        throw new Error("observedAt must be a valid timestamp.");
    }

    const observedAt = parsedObservedAt.toISOString();
    const ingestedAt = new Date().toISOString();

    const geohash = getGeohash(input);

    const observation: AQIObservation = {
        PK: `CELL#${geohash}`,
        SK: getObservationKey(observedAt, input.locationId),

        locationId: input.locationId,
        latitude: input.latitude,
        longitude: input.longitude,
        geohash,

        aqi: input.aqi,
        ...(input.indexCode
            ? { indexCode: input.indexCode }
            : {}),

        ...(input.indexName
            ? { indexName: input.indexName }
            : {}),

        ...(input.category
            ? { category: input.category }
            : {}),

        ...(input.dominantPollutant
            ? { dominantPollutant: input.dominantPollutant }
            : {}),

        source: input.source,
        observedAt,
        ingestedAt,

        expiresAt:
            Math.floor(Date.now() / 1000) +
            OBSERVATION_RETENTION_SECONDS,
    };

    await documentClient.send(
        new PutCommand({
            TableName: TABLE_NAME,
            Item: observation,
        })
    );

    return observation;
}

/**
 * Returns recent observations from the cell containing
 * the requested point and its eight neighboring cells.
 *
 * This function filters invalid and stale observations.
 * Distance filtering is performed separately before
 * interpolation.
 */
export async function getNearbyObservations(
    coordinates: Coordinates
): Promise<AQIObservation[]> {
    if (!isValidCoordinates(coordinates)) {
        throw new Error("Invalid query coordinates.");
    }

    const centerHash = getGeohash(coordinates);

    const cellHashes = [
        centerHash,
        ...ngeohash.neighbors(centerHash),
    ];

    const uniqueCellHashes = [...new Set(cellHashes)];

    const queryResults = await Promise.all(
        uniqueCellHashes.map(async (hash) => {
            const result = await documentClient.send(
                new QueryCommand({
                    TableName: TABLE_NAME,

                    KeyConditionExpression:
                        "PK = :pk AND begins_with(SK, :prefix)",

                    ExpressionAttributeValues: {
                        ":pk": `CELL#${hash}`,
                        ":prefix": "OBS#",
                    },

                    ScanIndexForward: false,
                    Limit: MAX_ITEMS_PER_CELL,
                })
            );

            return (result.Items ?? []) as AQIObservation[];
        })
    );

    const now = Date.now();

    return queryResults
        .flat()
        .filter((observation) => {
            const observedAt = Date.parse(observation.observedAt);

            const age = now - observedAt;

            return (
                isValidCoordinates(observation) &&
                isValidAQI(observation.aqi) &&
                Number.isFinite(observedAt) &&
                age >= 0 &&
                age <= MAX_OBSERVATION_AGE_MS
            );
        });
}