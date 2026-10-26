import type {FeatureCollection, MultiPolygon, Polygon} from "geojson";

function formatCoordinate(value: number): string {
    return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

// VAT-Spy stores one polygon per record, with coordinates ordered as latitude|longitude.
export function compileFirBoundaries(boundaries: FeatureCollection<Polygon | MultiPolygon>): string {
    const firstOceanicById = new Map<string, string>();
    const splitIds = new Set<string>();
    const lines: string[] = [];

    for (const feature of boundaries.features) {
        const {id, oceanic, label_lat, label_lon} = feature.properties!;
        const previousOceanic = firstOceanicById.get(id);
        if (previousOceanic === undefined) firstOceanicById.set(id, oceanic);

        const polygons = feature.geometry.type === 'MultiPolygon'
            ? feature.geometry.coordinates
            : [feature.geometry.coordinates];
        const isSplit = polygons.length > 1;

        for (const polygon of polygons) {
            let extension: string;
            if (isSplit) {
                extension = splitIds.has(id) ? '1' : '0';
                splitIds.add(id);
            } else {
                extension = previousOceanic === oceanic ? '1' : '0';
            }

            // Like the reference exporter, only the outer ring is written (holes are ignored).
            const coordinates = polygon[0]!;
            let minLat = Infinity;
            let minLon = Infinity;
            let maxLat = -Infinity;
            let maxLon = -Infinity;
            for (const [longitude, latitude] of coordinates) {
                minLat = Math.min(minLat, latitude);
                minLon = Math.min(minLon, longitude);
                maxLat = Math.max(maxLat, latitude);
                maxLon = Math.max(maxLon, longitude);
            }
            lines.push([
                id, oceanic, extension, coordinates.length,
                formatCoordinate(minLat), formatCoordinate(minLon),
                formatCoordinate(maxLat), formatCoordinate(maxLon),
                label_lat, label_lon,
            ].join('|'));

            for (const [longitude, latitude] of coordinates) {
                lines.push(`${formatCoordinate(Math.round(latitude * 1e6) / 1e6)}|${formatCoordinate(Math.round(longitude * 1e6) / 1e6)}`);
            }
        }
    }

    return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}
