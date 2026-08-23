import type {CompileContext} from "../compile.ts";
import type {
    Airport,
    AirportCompiled,
    Airports,
    PositionDefinition,
    PositionDefinitionCompiled,
    PositionReference,
    Positions,
    Sector,
    SectorCompiled,
    Sectors,
    Volumes
} from "../../types/index.ts";

export function getId(id: string, context: CompileContext) {
    if (context.currentFir) return `${context.currentFir}-${id}`

    return id
}

export function getPosition(
    position: PositionReference | string,
    context: CompileContext,
    currentFir = context.currentFir,
): PositionDefinitionCompiled | undefined {
    if (typeof position === 'string') position = {id: position}

    if (position.fir) {
        return context.positions[`${position.fir}-${position.id}`]
    }

    return (currentFir ? context.positions[`${currentFir}-${position.id}`] : undefined)
        ?? context.positions[position.id]
}

export function processPositions(positions: Positions, context: CompileContext) {
    for (let id in positions) {
        if (id === '$schema') continue

        const position = positions[id] as PositionDefinition;

        const positionId = getId(id, context);

        if (context.positions[positionId]) throw new Error(`Duplicate position ${id} (${positionId})`);

        context.positions[positionId] = {
            ...position,
            positions: [],
            _positions: [],
            division: context.currentDivision,
            subdivision: context.currentSubdivision ?? undefined,
            fir: context.currentFir ?? undefined,
        }

        for (let subPosition of position?.positions ?? []) {
            if (typeof subPosition === 'string') subPosition = {id: subPosition}

            context.positions[positionId].positions!.push(subPosition)
            context.positions[positionId]._positions!.push(subPosition)
            context.leftovers.push({
                position: context.positions[positionId],
                leftoverPosition: subPosition,
            })
        }
    }
}

export function processAirports(airports: Airports, context: CompileContext) {
    for (let icao in airports) {
        if (icao === '$schema') continue

        const airport = airports[icao] as Airport;
        if (context.airports[icao]) throw new Error(`Duplicate airport ${icao} (${context.currentDivision})`);

        if (airport.iata && context.airportIata.has(airport.iata)) throw new Error(`Duplicate airport ${icao} IATA (${airport.iata})`);
        else if (airport.iata) context.airportIata.add(airport.iata)

        if (airport.faaLid && context.airportFaa.has(airport.faaLid)) throw new Error(`Duplicate airport ${icao} FAA LID (${airport.faaLid})`);
        else if (airport.faaLid) context.airportFaa.add(airport.faaLid)

        if (airport.prefixes?.length) {
            for (const prefix of airport.prefixes) {
                if (context.airportPrefixes.has(prefix)) throw new Error(`Duplicate airport ${icao} prefix (${prefix})`);
                context.airportPrefixes.add(prefix)
            }
        }

        context.airports[icao] = {
            ...airport,
            division: context.currentDivision,
            subdivision: context.currentSubdivision ?? undefined,
            fir: context.currentFir!,
            runways: airport.runways?.map(x => typeof x === 'string' ? {name: x} : x),
            positions: [],
            _positions: [],
        }

        for (let subPosition of airport?.positions ?? []) {
            if (typeof subPosition === 'string') subPosition = {id: subPosition}
            else if ('icao' in subPosition) {
                context.leftovers.push({
                    airport: context.airports[icao],
                    leftoverAirport: subPosition.icao
                })

                context.airports[icao].positions!.push({id: subPosition.icao, fir: 'airport'})
                context.airports[icao]._positions!.push(subPosition)

                continue
            }

            context.airports[icao].positions!.push(subPosition)
            context.airports[icao]._positions!.push(subPosition)

            context.leftovers.push({
                airport: context.airports[icao],
                leftoverPosition: subPosition,
            })
        }
    }
}

export function processSectors(sectors: Sectors, context: CompileContext) {
    for (let id in sectors) {
        if (id === '$schema') continue
        const sector = sectors[id] as Sector;

        const sectorId = getId(id, context);

        if (context.sectors[sectorId]) throw new Error(`Duplicate sector ${id} (${sectorId})`);

        context.sectors[sectorId] = {
            ...sector,

            division: context.currentDivision,
            subdivision: context.currentSubdivision ?? undefined,
            fir: context.currentFir!,

            volumes: sector.volumes.map(x => getId(x, context)),
            positions: [],
            _positions: [],
        }

        for (let subPosition of sector?.positions ?? []) {
            if (typeof subPosition === 'string') subPosition = {id: subPosition}

            context.sectors[sectorId].positions!.push(subPosition)
            context.sectors[sectorId]._positions!.push(subPosition)
            context.leftovers.push({
                sector: context.sectors[sectorId],
                leftoverPosition: subPosition,
            })
        }
    }
}

export function processVolumes(volumes: Volumes, context: CompileContext) {
    for (const volume of volumes.features) {
        const volumeId = getId(volume.id, context);

        if (context.volumes[volumeId]) throw new Error(`Duplicate volume ${volume.id} (${volumeId})`);

        context.volumes[volumeId] = volume
    }
}

type PositionOrAirportReference = PositionReference | { icao: string };

interface ReferenceTraversalState {
    airports: Set<string>;
    positions: Set<PositionDefinitionCompiled>;
}

type PositionOwner = AirportCompiled | PositionDefinitionCompiled | SectorCompiled;

function findReferencesRecursive(
    position: PositionOrAirportReference,
    context: CompileContext,
    visited: ReferenceTraversalState,
    currentFir = context.currentFir,
): PositionReference[] {
    if ('icao' in position || position.fir === 'airport') {
        const icao = 'icao' in position ? position.icao : position.id
        const airport = context.airports[icao]
        if (!airport) throw new Error(`Was not able to find airport ${icao}`)
        if (visited.airports.has(icao)) return []

        visited.airports.add(icao)

        if (airport.positions?.length) {
            return airport.positions.flatMap(additionalPosition =>
                findReferencesRecursive(additionalPosition, context, visited, airport.fir)
            )
        }

        return [];
    }

    const foundPosition = getPosition(position, context, currentFir);
    if (!foundPosition) throw new Error(`Was not able to find position for ${position.id} (${position.fir ?? currentFir})`)
    if (visited.positions.has(foundPosition)) return []

    visited.positions.add(foundPosition)

    if (foundPosition.positions?.length) {
        return [
            position,
            ...foundPosition.positions.flatMap(additionalPosition =>
                findReferencesRecursive(additionalPosition, context, visited, foundPosition.fir ?? null)
            ),
        ];
    } else return [position];
}

export function processLeftovers(context: CompileContext) {
    const previousState = {
        division: context.currentDivision,
        subdivision: context.currentSubdivision,
        fir: context.currentFir,
    };
    const processedOwners = new Set<PositionOwner>();

    try {
        for (const leftover of context.leftovers) {
            const owner = (
                'airport' in leftover ? leftover.airport
                    : 'position' in leftover ? leftover.position
                        : leftover.sector
            ) as PositionOwner;

            if (processedOwners.has(owner)) continue
            processedOwners.add(owner)

            context.currentDivision = owner.division;
            context.currentSubdivision = owner.subdivision ?? null;
            context.currentFir = owner.fir ?? null;

            const visited: ReferenceTraversalState = {
                airports: new Set(),
                positions: new Set(),
            };

            // A position must never appear in its own expanded fallback list.
            if ('position' in leftover) visited.positions.add(leftover.position)

            const originalPositions = owner._positions ?? owner.positions ?? [];
            owner.positions = originalPositions.flatMap(position =>
                findReferencesRecursive(position, context, visited)
            );
        }

        context.leftovers.length = 0;

        for (const sector in context.sectors) {
            for (const volume of context.sectors[sector]!.volumes) {
                if (!context.volumes[volume]) throw new Error(`Was not able to find volume ${volume} for sector ${sector}`)
            }
        }
    } finally {
        context.currentDivision = previousState.division;
        context.currentSubdivision = previousState.subdivision;
        context.currentFir = previousState.fir;
    }
}
