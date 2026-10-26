import {center, featureCollection, union} from "@turf/turf";
import type {Feature, FeatureCollection, MultiPolygon, Polygon} from "geojson";
import type {CompileContext} from "../compile.ts";
import {getPositionVolumeCenter, normalizeBoundaryGeometry, resolveVolumeGeometry} from "../geometry.ts";
import type {PositionDefinitionCompiled} from "shared/types/index.ts";

type VatSpyBoundaries = FeatureCollection<Polygon | MultiPolygon> & {
    name: string;
    crs: {type: 'name'; properties: {name: string}};
};

function sortByFirstField(lines: string[]): string[] {
    return lines.sort((left, right) => left.split('|', 1)[0]!.localeCompare(right.split('|', 1)[0]!));
}

function compileBoundaries(context: CompileContext): VatSpyBoundaries {
    const features: Feature<Polygon | MultiPolygon>[] = [];

    for (const position of Object.values(context.positions)) {
        if (position.suffixes.length !== 1 || position.suffixes[0] !== 'CTR') continue;

        const division = context.divisions[position.division];
        if (!division) throw new Error(`Was not able to find division ${position.division} for position ${position.id}`);

        const volumeIds = new Set(position.sectors.flatMap(sectorId => context.sectors[sectorId]?.volumes ?? []));
        const fullRangeVolumes = [...volumeIds]
            .map(volumeId => context.volumes[volumeId])
            .filter(volume => volume
                && volume.properties.floor.unit === 'FL'
                && volume.properties.floor.value === 0
                && volume.properties.ceiling.unit === 'FL'
                && volume.properties.ceiling.value === 999);

        if (position.parent ? !fullRangeVolumes.length : fullRangeVolumes.length !== 1) continue;

        const volumes = fullRangeVolumes.map(volume => ({
            type: 'Feature' as const,
            properties: {},
            geometry: resolveVolumeGeometry(volume.id, context),
        }));
        if (!volumes.length) continue;

        let merged: Feature<Polygon | MultiPolygon> = volumes[0]!;
        for (const volume of volumes.slice(1)) {
            const result = union(featureCollection([merged, volume]));
            if (!result) throw new Error(`Was not able to merge volumes for position ${position.id}`);
            merged = result as Feature<Polygon | MultiPolygon>;
        }

        const [longitude, latitude] = position.labelCoordinate ?? center(merged).geometry.coordinates;
        features.push({
            type: 'Feature',
            properties: {
                id: position.id.replace(/^position:/, '').split('/').at(-1)!,
                oceanic: '0',
                label_lon: String(longitude),
                label_lat: String(latitude),
                region: division.region,
                division: division.code,
            },
            geometry: normalizeBoundaryGeometry(merged.geometry),
        });
    }

    return {
        type: 'FeatureCollection',
        name: 'VATSIM Map',
        crs: {type: 'name', properties: {name: 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
        features: features.sort((left, right) => String(left.properties?.id).localeCompare(String(right.properties?.id))),
    };
}

function compileDat(context: CompileContext): string {
    const countryRows: string[] = [];

    for (const division of Object.values(context.divisions)) {
        const prefixesMap: Record<string, string> = {};
        const callsigns = [
            ...(division.callsigns ?? []),
            ...Object.values(division.subdivisions ?? {}).flatMap(subdivision => subdivision.callsigns ?? []),
        ];

        for (const callsign of callsigns) {
            if (!callsign.prefixes || !callsign.suffixes?.includes('CTR')) continue;
            for (const prefix of callsign.prefixes) prefixesMap[prefix] = callsign.callsign;
        }

        for (const country of division.countries ?? []) {
            for (const prefix of country.prefixes) {
                countryRows.push(`${country.name}|${prefix}|${prefixesMap[prefix] ?? ''}`);
            }
        }
    }

    const airportRows: string[] = [];
    const iatas = new Set<string>();

    for (const icao in context.airports) {
        const airport = context.airports[icao]!;
        const baseAirport = `${icao}|${airport.name}|${airport.coordinate[1]}|${airport.coordinate[0]}`;

        airportRows.push(`${baseAirport}|${airport.iata ?? airport.faaLid ?? ''}|${airport.fir}|0`);

        if (airport.iata) {
            if (iatas.has(airport.iata)) throw new Error(`Duplicate airport prefix: ${airport.iata}`);
            iatas.add(airport.iata);
        }

        if (airport.faaLid) {
            if (iatas.has(airport.faaLid)) throw new Error(`Duplicate airport FAA LID: ${airport.faaLid}`);
            iatas.add(airport.faaLid);
        }

        if (airport.iata && airport.faaLid) airportRows.push(`${baseAirport}|${airport.faaLid}|${airport.fir}|1`);
        for (const prefix of airport.prefixes ?? []) {
            if (iatas.has(prefix)) throw new Error(`Duplicate airport prefix: ${prefix}`);
            iatas.add(prefix);
            airportRows.push(`${baseAirport}|${prefix}|${airport.fir}|1`);
        }
    }

    const firEntries: Array<{id: string; position: PositionDefinitionCompiled}> = [];
    const firRows: string[] = [];

    for (const position of Object.values(context.positions)) {
        if (position.suffixes.length === 1 && position.suffixes[0] === 'CTR' && position.prefixes.length === 1) {
            const volumeIds = new Set(position.sectors.flatMap(sectorId => context.sectors[sectorId]?.volumes ?? []));
            const fullRangeVolumes = [...volumeIds]
                .map(volumeId => context.volumes[volumeId])
                .filter(volume => volume
                    && volume.properties.floor.unit === 'FL'
                    && volume.properties.floor.value === 0
                    && volume.properties.ceiling.unit === 'FL'
                    && volume.properties.ceiling.value === 999);

            if (position.parent ? fullRangeVolumes.length > 0 : fullRangeVolumes.length === 1) {
                const id = position.id.replace(/^position:/, '').split('/').at(-1)!;
                firEntries.push({id, position});
                firRows.push(`${id}|${position.name ?? position.callsign ?? ''}|${position.prefixes[0]!}|${id}`);
            }
        }

        if (!position.suffixes.includes('APP')) continue;
        for (const prefix of position.prefixes) {
            const icao = prefix.split('_', 1)[0]!;
            if (context.airports[icao] || iatas.has(icao)) continue;

            const [longitude, latitude] = getPositionVolumeCenter(position, context);
            airportRows.push(`${icao}|${position.name ?? ''}|${latitude}|${longitude}|${icao}|${position.fir ?? ''}|1`);
            iatas.add(icao);
        }
    }

    const uirRows: string[] = [];
    for (const uir of Object.values(context.positions)) {
        if (uir.suffixes.length !== 1 || uir.suffixes[0] !== 'FSS') continue;

        const firIds = firEntries
            .filter(({position}) => position.resolvedParent?.some(parent => parent.id === uir.id)
                && (!position.parent || position.parent.id === uir.id))
            .map(({id}) => id);
        if (!firIds.length) continue;

        // VAT-Spy resolves UIRs by callsign prefix (e.g. RU-NWC), not by the
        // internal position id (NWC).
        const id = uir.prefixes[0];
        if (!id) throw new Error(`UIR position ${uir.id} has no callsign prefix`);
        uirRows.push(`${id}|${uir.name ?? uir.callsign ?? ''}|${firIds.join(',')}`);
    }

    let result = `[Countries]\n${sortByFirstField(countryRows).join('\n')}\n\n`;
    result += `[Airports]\n;ICAO|Airport Name|Latitude Decimal|Longitude Decimal|IATA/LID|FIR|IsPseudo\n${sortByFirstField(airportRows).join('\n')}\n\n`;
    result += `[FIRs]\n;ICAO|NAME|CALLSIGN PREFIX|FIR BOUNDARY\n${sortByFirstField(firRows).join('\n')}\n\n`;
    result += `[UIRs]\n;ICAO|NAME|FIRs\n${sortByFirstField(uirRows).join('\n')}\n\n`;
    result += `[IDL]
90.0|-180.0
75.0|-180.0
67.5|-169.0
65.5|-169.0
52.0|-192.5
48.0|-180.0
5.0|-180.0
0.0|-178.0
0.0|-169.0
-1.5|-169.0
-1.5|-159.0
1.0|-159.0
1.0|-162.0
5.0|-162.0
5.0|-155.0
-9.0|-148.0
-12.0|-148.0
-12.0|-157.5
-7.0|-157.5
-7.0|-179.0
-15.0|-172.5
-45.0|-172.5
-52.0|-180.0
-90.0|-180.0`;

    return result;
}

export function compileVatSpy(context: CompileContext): {
    boundaries: FeatureCollection<Polygon | MultiPolygon>;
    dat: string;
} {
    return {
        boundaries: compileBoundaries(context),
        dat: compileDat(context),
    };
}
