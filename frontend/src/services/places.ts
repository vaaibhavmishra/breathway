const AWS_REGION = import.meta.env.VITE_AWS_REGION ?? "ap-southeast-2";
const AWS_LOCATION_API_KEY = import.meta.env.VITE_AWS_LOCATION_API_KEY;

export type PlaceSuggestion = {
    title: string;
    address: string;
    coordinates: [number, number];
};

type AmazonPlaceResult = {
    Title?: string;
    Address?: { Label?: string };
    Position?: [number, number];
};

type AmazonPlacesResponse = {
    ResultItems?: AmazonPlaceResult[];
};

/** Search for places using Amazon Location Places V2. Coordinates are [longitude, latitude]. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) return [];

    if (!AWS_LOCATION_API_KEY) {
        throw new Error("Missing VITE_AWS_LOCATION_API_KEY. Check your frontend .env file.");
    }

    const response = await fetch(
        `https://places.geo.${AWS_REGION}.amazonaws.com/v2/search-text?key=${encodeURIComponent(AWS_LOCATION_API_KEY)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                QueryText: trimmedQuery,
                MaxResults: 5,
                // Bias results toward Delhi while allowing searches elsewhere.
                BiasPosition: [77.2090, 28.6139],
            }),
        }
    );

    if (!response.ok) {
        const errorDetails = await response.text();
        console.error("Amazon Location search error:", response.status, errorDetails);
        throw new Error(`Location search failed (${response.status}).`);
    }

    const data = (await response.json()) as AmazonPlacesResponse;

    return (data.ResultItems ?? [])
        .filter(
            (place) =>
                typeof place.Title === "string" &&
                Array.isArray(place.Position) &&
                place.Position.length === 2 &&
                place.Position.every(
                    (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)
                )
        )
        .map((place) => ({
            title: place.Title!,
            address: place.Address?.Label ?? place.Title!,
            coordinates: [place.Position![0], place.Position![1]] as [number, number],
        }));
}
