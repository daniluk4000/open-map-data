import {center, convex, featureCollection} from "@turf/turf";
import type {MultiPolygon, Polygon} from "geojson";
import type {CompileContext} from "./compile.ts";
import type {PositionDefinitionCompiled} from "shared/types/index.ts";

export function normalizeBoundaryGeometry(geometry: Polygon | MultiPolygon): MultiPolygon {
    if (geometry.type === 'Polygon') return {type: 'MultiPolygon', coordinates: [geometry.coordinates]};
    if (geometry.coordinates.length <= 2) return geometry;

    const hull = convex({
        type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {}, geometry}],
    });
    if (!hull) throw new Error('Was not able to merge boundary polygons into one');

    return {type: 'MultiPolygon', coordinates: [hull.geometry.coordinates]};
}

export function resolveVolumeGeometry(
    volumeId: string,
    context: CompileContext,
    visited = new Set<string>(),
): Polygon | MultiPolygon {
    const volume = context.volumes[volumeId];
    if (!volume) throw new Error(`Was not able to find volume ${volumeId} for pseudo-airport coordinates`);
    if (volume.geometry) return volume.geometry;
    if (!volume.properties.geometryFromVolume) {
        throw new Error(`Volume ${volumeId} has no geometry and no geometryFromVolume`);
    }
    if (visited.has(volumeId)) throw new Error(`Circular geometryFromVolume reference at ${volumeId}`);

    visited.add(volumeId);
    return resolveVolumeGeometry(volume.properties.geometryFromVolume, context, visited);
}

export function getPositionVolumeCenter(position: PositionDefinitionCompiled, context: CompileContext): [number, number] {
    const volumeIds = new Set<string>();
    for (const sectorId of position.sectors) {
        const sector = context.sectors[sectorId];
        for (const volumeId of sector?.volumes ?? []) volumeIds.add(volumeId);
    }

    const features = [...volumeIds].map(id => {
        const volume = context.volumes[id];
        if (!volume) throw new Error(`Was not able to find volume ${id} for position ${position.id}`);
        return {
            type: 'Feature' as const,
            properties: {},
            geometry: resolveVolumeGeometry(id, context),
        };
    });
    if (!features.length) throw new Error(`Position ${position.id} has no volumes for pseudo-airport coordinates`);

    return center(featureCollection(features)).geometry.coordinates as [number, number];
}
