import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Feature, FeatureCollection, MultiPolygon, Polygon} from 'geojson';
import type {Airport, Division, PositionDefinition, Sector, Volumes} from 'shared/types/index.ts';
import {checkSchema} from './index.ts';

/** Keys are existing division codes from divisions/. Subdivision IDs must exist in division.json. */
type SimAwareSelection = {id: string; fir: string};
export type MigrationConfig = Record<string, {
    /** Explicit SimAware geometry ID and its destination FIR. */
    simawareIds?: SimAwareSelection[];
    /** prefixes locate a FIR; simawareIds select features for this subdivision and supply their FIR. */
    subdivisions?: Record<string, {prefixes?: string[]; simawareIds?: SimAwareSelection[]}>;
}>;
type Shape = Polygon | MultiPolygon;
type Boundary = Feature<Shape, {id: string; oceanic?: string; label_lon?: string; label_lat?: string}>;
type SimAwareFeature = Feature<Shape, {
    id: string; prefix: string[]; suffix?: string; name: string;
    label_lon?: number; label_lat?: number;
}>;
export type SimAwareData = {features: Array<SimAwareFeature | {features: SimAwareFeature[]}>};
type AirportRow = {icao: string; name: string; lat: number; lon: number; iata: string; fir: string; pseudo: boolean};
type FirRow = {icao: string; name: string; prefix: string; boundary: string};
type UirRow = {icao: string; name: string; firs: string[]};
type FirData = {
    /** Editable FIR files loaded into memory before the validation/write phase. */
    airports: Record<string, Airport>;
    positions: Record<string, PositionDefinition>;
    sectors: Record<string, Sector>;
    volumes: Volumes;
};

export function validateMigrationConfig(config: MigrationConfig, divisionsFolder: string): Record<string, Division> {
    // Fail before downloading data or touching files if a configured division is
    // missing, has no usable country prefixes, or names an unknown subdivision.
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('migration.json must be an object');
    const validSelections = (value: unknown): value is SimAwareSelection[] =>
        Array.isArray(value) && value.every(entry => entry && typeof entry === 'object' &&
            typeof entry.id === 'string' && entry.id.length > 0 &&
            typeof entry.fir === 'string' && /^[A-Za-z0-9-]+$/.test(entry.fir));
    const divisions: Record<string, Division> = {};
    for (const [code, options] of Object.entries(config)) {
        if (!/^[\w-]+$/.test(code)) throw new Error(`Invalid division code: ${code}`);
        const path = join(divisionsFolder, code, 'division.json');
        if (!existsSync(path)) throw new Error(`Division ${code} must already exist in divisions`);
        const division = checkSchema('divisions', JSON.parse(readFileSync(path, 'utf8')));
        if (division.code !== code || !division.countries?.some(country => country.prefixes?.length)) {
            throw new Error(`Division ${code} must have a country with at least one prefix`);
        }
        if (!options || typeof options !== 'object' || Array.isArray(options) ||
            (options.simawareIds !== undefined && !validSelections(options.simawareIds))) {
            throw new Error(`Invalid migration settings for ${code}`);
        }
        if (options.subdivisions !== undefined) {
            if (!options.subdivisions || typeof options.subdivisions !== 'object' || Array.isArray(options.subdivisions)) {
                throw new Error(`Invalid subdivisions for ${code}`);
            }
            for (const [subdivision, mapping] of Object.entries(options.subdivisions)) {
                if (!Object.hasOwn(division.subdivisions ?? {}, subdivision) || !mapping ||
                    typeof mapping !== 'object' || Array.isArray(mapping) ||
                    (mapping.prefixes !== undefined && (!Array.isArray(mapping.prefixes) ||
                        !mapping.prefixes.every(prefix => typeof prefix === 'string' && prefix.length))) ||
                    (mapping.simawareIds !== undefined && !validSelections(mapping.simawareIds)) ||
                    (!mapping.prefixes?.length && !mapping.simawareIds?.length)) {
                    throw new Error(`Invalid subdivision mapping ${code}/${subdivision}`);
                }
            }
        }
        divisions[code] = division;
    }
    return divisions;
}

function section(dat: string, name: string): string[][] {
    // VATSpy.dat separates sections with blank lines; lines starting with ';'
    // are comments, including the column headings. Inline ';' starts a comment.
    const content = dat.match(new RegExp(`(?:^|\\n)\\[${name}\\]\\r?\\n([\\s\\S]*?)(?=\\r?\\n\\s*\\r?\\n|$)`))?.[1];
    if (content === undefined) throw new Error(`Missing VATSpy section [${name}]`);
    return content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith(';'))
        .map(line => line.split('|').map(value => value.split(';')[0]!.trim()));
}

function matches(value: string, prefixes: string[]): boolean {
    return prefixes.some(prefix => value.startsWith(prefix));
}

function unique<T>(items: Iterable<T>): T | undefined {
    // Used for safe routing: zero or several distinct candidates both mean
    // "cannot determine unambiguously" and must not be guessed.
    const distinct = new Set(items);
    return distinct.size === 1 ? distinct.values().next().value : undefined;
}

function loadFir(path: string): FirData {
    // A missing file starts empty; an existing file is used as the source of
    // truth so hand-edited entries are not replaced by upstream data.
    const read = <T>(name: string, fallback: T): T => existsSync(join(path, name))
        ? JSON.parse(readFileSync(join(path, name), 'utf8')) as T : fallback;
    return {
        airports: read('airports.json', {}),
        positions: read('positions.json', {}),
        sectors: read('sectors.json', {}),
        volumes: read('volumes.geojson', {type: 'FeatureCollection', features: []}),
    };
}

function addFeature(data: FirData, id: string, geometry: Shape): boolean {
    // Migration volumes represent the full flight-level range; there is no
    // reliable altitude/parent hierarchy in the source datasets.
    if (data.volumes.features.some(feature => feature.id === id)) return false;
    data.volumes.features.push({type: 'Feature', id, properties: {floor: 0, ceiling: 999}, geometry});
    return true;
}

function addSector(data: FirData, id: string, positionId: string): boolean {
    // An already defined sector (including its owners) is left untouched.
    if (data.sectors[id]) return false;
    data.sectors[id] = {volumes: [id], positions: [positionId]};
    return true;
}

function coordinate(lon: string | number | undefined, lat: string | number | undefined): [number, number] | undefined {
    const x = Number(lon), y = Number(lat);
    return lon !== undefined && lat !== undefined && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

/**
 * Sync missing VATSpy and SimAware entries into the division/FIR source files.
 * Routing and schema validation happen before any disk writes. Existing
 * positions, sectors, volumes, and airports retain their manually edited values.
 */
export function migrate(
    config: MigrationConfig, divisionsFolder: string, dat: string, boundariesJson: unknown, simaware: SimAwareData,
): string {
    const divisions = validateMigrationConfig(config, divisionsFolder);
    // Only country prefixes of explicitly configured divisions participate in
    // this run; division codes alone do not identify all of their FIRs.
    const prefixByDivision = Object.fromEntries(Object.entries(divisions).map(([code, division]) =>
        [code, division.countries!.flatMap(country => country.prefixes)])) as Record<string, string[]>;
    const airports = section(dat, 'Airports').map(([icao, name, lat, lon, iata, fir, pseudo]): AirportRow => ({
        icao: icao ?? '', name: name ?? '', lat: Number(lat), lon: Number(lon), iata: iata ?? '', fir: fir ?? '', pseudo: pseudo === '1',
    }));
    const firs = section(dat, 'FIRs').map(([icao, name, prefix, boundary]): FirRow => ({
        icao: icao ?? '', name: name ?? '', prefix: prefix ?? '', boundary: boundary ?? icao ?? '',
    }));
    const uirs = section(dat, 'UIRs').map(([icao, name, firs]): UirRow => ({
        icao: icao ?? '', name: name ?? '', firs: firs?.split(',').filter(Boolean) ?? [],
    }));
    const boundaries = boundariesJson as FeatureCollection<Shape, Boundary['properties']>;
    if (!Array.isArray(boundaries?.features) || !Array.isArray(simaware?.features)) throw new Error('Invalid GeoJSON source');

    // VATSpy lists FIR sectors as separate [FIRs] rows: ZBAA-BJE is a
    // boundary/position inside ZBAA, not another FIR directory. Only collapse
    // a hyphenated code when its base also exists as a [FIRs] row.
    const firCodes = new Set(firs.map(row => row.icao));
    const canonicalFir = (code: string): string => {
        const base = code.split('-')[0]!;
        return code !== base && firCodes.has(base) ? base : code;
    };

    // Resolve FIR -> division by its own prefix first. Some FIR codes (KZBW)
    // differ from their airports' country prefix (KB); for those, use a strict
    // majority of the FIR's real airports. One outlier (ZJC0 in UHMM) must not
    // move an entire foreign FIR into a different division.
    const firOwners = new Map<string, string>();
    const canonicalFirs = new Set([...firCodes].map(canonicalFir));
    for (const fir of canonicalFirs) {
        const byCode = Object.entries(prefixByDivision).filter(([, prefixes]) => matches(fir, prefixes)).map(([code]) => code);
        const firAirports = airports.filter(airport => !airport.pseudo && canonicalFir(airport.fir) === fir);
        const owners = byCode.length ? byCode : Object.entries(prefixByDivision).filter(([, prefixes]) =>
            firAirports.filter(airport => matches(airport.icao, prefixes)).length > firAirports.length / 2
        ).map(([code]) => code);
        if (owners.length > 1) throw new Error(`Duplicate FIR ${fir}: prefixes match divisions ${owners.join(', ')}`);
        const owner = unique(owners);
        if (owner) firOwners.set(fir, owner);
    }

    // VATSpy airport.fir is authoritative even if the code is absent from
    // [FIRs]. Sector ownership and destination ownership are separate: a
    // matching airport in UHMM must not import UHMM's foreign boundaries.
    const destinationOwners = new Map(firOwners);
    for (const airport of airports) {
        if (airport.pseudo || !airport.fir || !airport.icao) continue;
        const owners = Object.entries(prefixByDivision).filter(([, prefixes]) => matches(airport.icao, prefixes))
            .map(([code]) => code);
        if (owners.length > 1) throw new Error(`Airport ${airport.icao} matches multiple divisions: ${owners.join(', ')}`);
        const owner = owners[0];
        if (!owner) continue;
        const fir = canonicalFir(airport.fir);
        const previous = destinationOwners.get(fir);
        if (previous && previous !== owner) throw new Error(`Duplicate FIR ${fir}: ${previous}, ${owner}`);
        destinationOwners.set(fir, owner);
    }

    // An explicit SimAware entry has its FIR supplied by the user, so it can
    // select a FIR absent from VATSpy. Reject conflicting explicit assignments.
    const explicitSelections = new Map<string, Map<string, string>>();
    for (const [code, options] of Object.entries(config)) {
        const byId = new Map<string, string>();
        for (const selection of [
            ...(options.simawareIds ?? []),
            ...Object.values(options.subdivisions ?? {}).flatMap(mapping => mapping.simawareIds ?? []),
        ]) {
            const fir = canonicalFir(selection.fir);
            if (byId.has(selection.id) && byId.get(selection.id) !== fir) {
                throw new Error(`Conflicting FIRs for SimAware ID ${selection.id} in ${code}`);
            }
            if (destinationOwners.has(fir) && destinationOwners.get(fir) !== code) {
                throw new Error(`FIR ${fir} belongs to ${destinationOwners.get(fir)}, not ${code}`);
            }
            byId.set(selection.id, fir);
            destinationOwners.set(fir, code);
        }
        explicitSelections.set(code, byId);
    }

    // Resolve FIR -> subdivision in a separate preflight pass. The compiler
    // requires a FIR to occupy exactly one directory, so overlapping prefix
    // rules must fail before any files are written.
    const firSubdivisions = new Map<string, string>();
    for (const [fir, owner] of destinationOwners) {
        const mappings = config[owner]?.subdivisions ?? {};
        const matchesForFir = Object.entries(mappings).filter(([, mapping]) =>
            matches(fir, mapping.prefixes ?? []) || airports.some(airport =>
                !airport.pseudo && canonicalFir(airport.fir) === fir && matches(airport.icao, mapping.prefixes ?? []))
        ).map(([code]) => code);
        if (matchesForFir.length > 1) {
            throw new Error(`Duplicate FIR ${fir}: prefixes match subdivisions ${owner}/${matchesForFir.join(', ')}`);
        }
        const subdivision = matchesForFir[0];
        if (subdivision) firSubdivisions.set(fir, subdivision);
    }

    // Keep changes in memory until every source has been processed. A key is
    // division/FIR; changedFirs prevents rewriting untouched existing files.
    const changes = new Map<string, FirData>();
    const changedFirs = new Set<string>();

    function getFir(code: string, fir: string, simawareId?: string): FirData | undefined {
        // An explicit SimAware ID may choose a subdivision when prefixes did
        // not choose one. If it contradicts the FIR's location, skip it rather
        // than create the same FIR in two subdivision directories.
        if (!fir || destinationOwners.get(fir) !== code) return undefined;
        const hasSubdivisions = Object.keys(divisions[code]!.subdivisions ?? {}).length > 0;
        let subdivision = firSubdivisions.get(fir);
        if (simawareId && hasSubdivisions) {
            const explicitMatches = Object.entries(config[code]?.subdivisions ?? {})
                .filter(([, mapping]) => mapping.simawareIds?.some(item => item.id === simawareId)).map(([name]) => name);
            if (explicitMatches.length > 1) return undefined;
            const explicit = explicitMatches[0];
            if (explicit) {
                if (subdivision && subdivision !== explicit) return undefined;
                subdivision = explicit;
                firSubdivisions.set(fir, subdivision);
            }
        }
        if (hasSubdivisions && !subdivision) return undefined;
        const key = `${code}/${fir}`;
        let data = changes.get(key);
        if (!data) {
            data = loadFir(join(divisionsFolder, code, ...(subdivision ? [subdivision] : []), fir));
            changes.set(key, data);
        }
        return data;
    }

    let added = 0;
    // VATSpy's FIR rows describe controller callsign prefixes and refer to
    // boundary geometry by ID. Multiple rows may share a boundary: import it
    // only when all rows agree on one FIR, without inventing parent positions.
    const byBoundary = new Map<string, FirRow[]>();
    for (const row of firs) {
        const list = byBoundary.get(row.boundary) ?? [];
        list.push(row);
        byBoundary.set(row.boundary, list);
    }
    for (const boundary of boundaries.features) {
        const id = boundary.properties?.id;
        if (!id || !boundary.geometry || !['Polygon', 'MultiPolygon'].includes(boundary.geometry.type)) continue;
        const rows = byBoundary.get(id) ?? [];
        const fir = unique(rows.map(row => canonicalFir(row.icao)));
        const owner = fir && firOwners.get(fir);
        const data = owner && fir && getFir(owner, fir);
        if (!data) continue;
        // Boundary features can occur more than once (disjoint polygons). Merge
        // their polygons without dropping either feature.
        const same = boundaries.features.filter(feature => feature.properties?.id === id && feature.geometry);
        const polygons = same.flatMap(feature => feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates] : feature.geometry.coordinates);
        if (addFeature(data, id, {type: 'MultiPolygon', coordinates: polygons})) {
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
        // One boundary becomes a volume and a sector; distinct callsign
        // prefixes from its FIR rows become independent owning positions.
        const positionIds: string[] = [];
        const seenPrefixes = new Set<string>();
        for (const row of rows) {
            const prefix = row.prefix || row.icao;
            if (seenPrefixes.has(prefix)) continue;
            seenPrefixes.add(prefix);
            const positionId = positionIds.length ? prefix : id;
            positionIds.push(positionId);
            if (data.positions[positionId]) continue;
            data.positions[positionId] = {name: row.name, prefixes: [prefix], suffixes: ['CTR'],
                ...(coordinate(boundary.properties?.label_lon, boundary.properties?.label_lat)
                    ? {labelCoordinate: coordinate(boundary.properties?.label_lon, boundary.properties?.label_lat)} : {})};
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
        if (positionIds.length && !data.sectors[id]) {
            data.sectors[id] = {volumes: [id], positions: positionIds};
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
    }

    // Each VATSpy airport already carries its FIR; use that field directly for
    // placement. ICAO prefixes only select airports of the current division.
    // Pseudo aliases must not shadow the real airport with the same ICAO.
    for (const airport of airports) {
        if (airport.pseudo || !airport.icao || !airport.name || !Number.isFinite(airport.lat) || !Number.isFinite(airport.lon)) continue;
        const fir = canonicalFir(airport.fir);
        const owner = destinationOwners.get(fir);
        if (!owner || !matches(airport.icao, prefixByDivision[owner]!)) continue;
        const data = getFir(owner, fir);
        if (data && !data.airports[airport.icao]) {
            // VATSpy's IATA/LID column mixes IATA and FAA LID. When the ICAO
            // ends in that identifier (KABC -> ABC), treat it as an FAA LID.
            const identifier = airport.iata
                ? (airport.icao.endsWith(airport.iata) ? {faaLid: airport.iata} : {iata: airport.iata})
                : {};
            data.airports[airport.icao] = {name: airport.name, coordinate: [airport.lon, airport.lat],
                ...identifier};
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
    }

    // SimAware does not carry FIR IDs. Use the explicitly configured FIR when
    // available; otherwise try to resolve each callsign prefix through
    // VATSpy's airport -> FIR mapping. Unmapped prefixes cannot be guessed.
    const airportFirs = new Map<string, Set<string>>();
    for (const airport of airports) {
        const fir = canonicalFir(airport.fir);
        if (airport.pseudo || !destinationOwners.has(fir)) continue;
        const set = airportFirs.get(airport.icao) ?? new Set<string>();
        set.add(fir);
        airportFirs.set(airport.icao, set);
    }
    // Releases may wrap a feature in another FeatureCollection. Repeated IDs
    // can describe multiple prefixes/polygons of the same controller: group
    // them by FIR, ID and suffix before adding a single position and volume.
    const simawareFeatures = simaware.features.flatMap(raw => 'features' in raw ? raw.features : [raw]);
    const simawareGroups = new Map<string, {features: SimAwareFeature[]; fir: string; owner: string}>();
    for (const feature of simawareFeatures) {
        if (!feature?.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
        const {id, prefix, name} = feature.properties ?? {};
        if (!id || !name || !Array.isArray(prefix) || !prefix.length) continue;
        const candidateFirs = prefix.flatMap(value => [...(airportFirs.get(value.split('_')[0]!) ?? [])]);
        const inferredFir = candidateFirs.length === prefix.length ? unique(candidateFirs) : undefined;
        const explicitlySelected = [...explicitSelections]
            .filter(([, ids]) => ids.has(id));
        if (explicitlySelected.length > 1) throw new Error(`SimAware ID ${id} is assigned to multiple divisions`);
        const explicit = explicitlySelected[0];
        const fir = explicit?.[1].get(id) ?? inferredFir;
        if (!fir) continue;
        const owner = explicit?.[0] ?? destinationOwners.get(fir);
        if (!owner) continue;
        const explicitSubdivision = Object.values(config[owner]?.subdivisions ?? {})
            .some(mapping => mapping.simawareIds?.some(item => item.id === id));
        // An explicit ID bypasses the prefix filter, but always supplies a FIR.
        if (!prefix.some(value => matches(value, prefixByDivision[owner]!)) &&
            !explicit && !explicitSubdivision) continue;
        const suffix = feature.properties.suffix || 'APP';
        const key = `${owner}/${fir}/${id}-${suffix}`;
        const group = simawareGroups.get(key) ?? {features: [], fir, owner};
        group.features.push(feature);
        simawareGroups.set(key, group);
    }
    for (const {features, fir, owner} of simawareGroups.values()) {
        const feature = features[0]!;
        const {id, name} = feature.properties;
        const data = getFir(owner, fir, id);
        if (!data) continue;
        const suffix = feature.properties.suffix || 'APP';
        const positionId = `${id}-${suffix}`;
        if (!data.positions[positionId]) {
            data.positions[positionId] = {name, prefixes: [...new Set(features.flatMap(item => item.properties.prefix))], suffixes: [suffix],
                ...(coordinate(feature.properties.label_lon, feature.properties.label_lat)
                    ? {labelCoordinate: coordinate(feature.properties.label_lon, feature.properties.label_lat)} : {})};
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
        const sectorId = positionId;
        const polygons = features.flatMap(item => item.geometry.type === 'Polygon'
            ? [item.geometry.coordinates] : item.geometry.coordinates);
        if (addFeature(data, sectorId, {type: 'MultiPolygon', coordinates: polygons})) {
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
        if (addSector(data, sectorId, positionId)) {
            added++;
            changedFirs.add(`${owner}/${fir}`);
        }
    }

    // UIRs are division-level FSS positions: every member FIR must belong to
    // this division. They never go into a FIR or subdivision positions.json.
    const changedRootPositions = new Map<string, Record<string, PositionDefinition>>();
    for (const code of Object.keys(divisions)) {
        const path = join(divisionsFolder, code, 'positions.json');
        const positions = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, PositionDefinition> : {};
        let dirty = false;
        for (const uir of uirs) {
            if (!uir.icao || !uir.name || !uir.firs.length || positions[uir.icao]) continue;
            if (uir.firs.some(fir => destinationOwners.get(canonicalFir(fir)) !== code)) continue;
            positions[uir.icao] = {name: uir.name, prefixes: [uir.icao], suffixes: ['FSS']};
            added++;
            dirty = true;
        }
        if (dirty) changedRootPositions.set(path, positions);
    }

    // Validate all changed files before writing anything. Unchanged files keep
    // their original formatting and content on subsequent migration runs.
    for (const positions of changedRootPositions.values()) checkSchema('positions', positions);
    for (const key of changedFirs) {
        const data = changes.get(key)!;
        checkSchema('airports', data.airports);
        checkSchema('positions', data.positions);
        checkSchema('sectors', data.sectors);
        checkSchema('volumes', data.volumes);
    }
    for (const [path, positions] of changedRootPositions) {
        writeFileSync(path, JSON.stringify(positions, null, 2) + '\n');
    }
    for (const key of changedFirs) {
        const data = changes.get(key)!;
        const [code, fir] = key.split('/');
        const subdivision = firSubdivisions.get(fir!);
        const path = join(divisionsFolder, code!, ...(subdivision ? [subdivision] : []), fir!);
        mkdirSync(path, {recursive: true});
        for (const [name, value] of Object.entries({
            'airports.json': data.airports, 'positions.json': data.positions,
            'sectors.json': data.sectors, 'volumes.geojson': data.volumes,
        })) {
            const target = join(path, name);
            // A FIR containing only sectors does not need an empty airports.json;
            // likewise an airport-only FIR needs no empty sector/volume files.
            if (!existsSync(target) && (name === 'volumes.geojson'
                ? data.volumes.features.length === 0
                : Object.keys(value).length === 0)) continue;
            const text = JSON.stringify(value, null, 2) + '\n';
            if (!existsSync(target) || readFileSync(target, 'utf8') !== text) {
                writeFileSync(target, text);
            }
        }
    }
    return `Migration complete: ${added} new entries`;
}
