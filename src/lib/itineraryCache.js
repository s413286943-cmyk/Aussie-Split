const ITINERARY_CACHE_KEY = "aussie-chill-itinerary-v1";

export function readCachedItinerary(storage) {
  if (!storage?.getItem) return null;
  try {
    const itinerary = JSON.parse(storage.getItem(ITINERARY_CACHE_KEY) || "null");
    return validItinerary(itinerary) ? itinerary : null;
  } catch {
    return null;
  }
}

export function writeCachedItinerary(storage, itinerary) {
  if (!storage?.setItem) throw new TypeError("Itinerary cache storage is unavailable");
  if (!validItinerary(itinerary)) throw new TypeError("Invalid itinerary cache payload");
  storage.setItem(ITINERARY_CACHE_KEY, JSON.stringify(itinerary));
  return itinerary;
}

function validItinerary(itinerary) {
  return Boolean(
    itinerary
    && typeof itinerary.trip === "object"
    && Array.isArray(itinerary.stages)
    && Array.isArray(itinerary.days)
    && itinerary.stages.every((stage) => typeof stage?.id === "string")
    && itinerary.days.every((day) => typeof day?.id === "string"),
  );
}
