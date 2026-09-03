(function exposeLeakMapTools(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LeakMapTools = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function buildLeakMapTools() {
  const EARTH_RADIUS_METERS = 6371008.8;

  function point(value) {
    if (Array.isArray(value)) return { lat: Number(value[0]), lng: Number(value[1]) };
    return { lat: Number(value?.lat), lng: Number(value?.lng ?? value?.lon) };
  }

  function validPoint(value) {
    const candidate = point(value);
    return Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) ? candidate : null;
  }

  function distanceMeters(from, to) {
    const a = validPoint(from);
    const b = validPoint(to);
    if (!a || !b) return null;
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(b.lat - a.lat);
    const longitudeDelta = radians(b.lng - a.lng);
    const firstLatitude = radians(a.lat);
    const secondLatitude = radians(b.lat);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
  }

  function normalizeBounds(bounds) {
    const southWest = validPoint(bounds?.southWest || bounds?.sw || bounds?.[0]);
    const northEast = validPoint(bounds?.northEast || bounds?.ne || bounds?.[1]);
    if (!southWest || !northEast) return null;
    return {
      south: Math.min(southWest.lat, northEast.lat),
      north: Math.max(southWest.lat, northEast.lat),
      west: Math.min(southWest.lng, northEast.lng),
      east: Math.max(southWest.lng, northEast.lng),
    };
  }

  function pointInBounds(value, bounds) {
    const candidate = validPoint(value);
    const normalized = normalizeBounds(bounds);
    if (!candidate || !normalized) return false;
    return candidate.lat >= normalized.south
      && candidate.lat <= normalized.north
      && candidate.lng >= normalized.west
      && candidate.lng <= normalized.east;
  }

  function idsWithinBounds(entries, bounds) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry?.id != null && pointInBounds(entry, bounds))
      .map((entry) => String(entry.id));
  }

  function roundedDistance(from, to) {
    const value = distanceMeters(from, to);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
  }

  return { distanceMeters, roundedDistance, pointInBounds, idsWithinBounds };
}));
