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

export function getId(
    id: string,
    type: 'position' | 'sector' | 'volume',
    context: CompileContext,
    currentFir = context.currentFir,
) {
    if (currentFir) return `${type}:${context.currentDivision}/${currentFir}/${id}`
    if (context.currentDivision) return `${type}:${context.currentDivision}/${id}`

    return `${type}:id`
}

export function getPosition(
    position: PositionReference | string,
    context: CompileContext,
    currentFir = context.currentFir,
): PositionDefinitionCompiled | undefined {
    if (typeof position === 'string') position = {id: position}

    const positionId = getPositionId(position, context, currentFir)
    return positionId ? context.positions[positionId] : undefined
}

function getPositionId(
    position: PositionReference,
    context: CompileContext,
    currentFir: string | null,
): string | undefined {
    if (context.positions[position.id]) return position.id

    const positionId = getId(position.id, 'position', context, position.fir ?? currentFir)
    if (context.positions[positionId]) return positionId

    // A FIR-local reference may fall back to a division-level position.
    if (!position.fir && currentFir) {
        const divisionPositionId = getId(position.id, 'position', context, null)
        if (context.positions[divisionPositionId]) return divisionPositionId
    }

    return undefined
}

export function processPositions(positions: Positions, context: CompileContext) {
    for (let id in positions) {
        if (id === '$schema') continue

        const position = positions[id] as PositionDefinition;

        const positionId = getId(id, 'position', context);

        if (context.positions[positionId]) throw new Error(`Duplicate position ${id} (${positionId})`);

        context.positions[positionId] = {
            ...position,
            division: context.currentDivision,
            subdivision: context.currentSubdivision ?? undefined,
            fir: context.currentFir ?? undefined,
            parent: typeof position.parent === 'string' ? {id: position.parent} : position.parent,
            resolvedParent: [],
        }

        if (context.positions[positionId].parent) context.leftovers.push({
            position: context.positions[positionId],
            leftoverPosition: context.positions[positionId].parent
        })
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
            resolvedPositions: [],
        }

        for (let subPosition of airport?.positions ?? []) {
            if (typeof subPosition === 'string') subPosition = {id: subPosition}
            else if ('icao' in subPosition) {
                context.leftovers.push({
                    airport: context.airports[icao],
                    leftoverAirport: subPosition.icao
                })

                context.airports[icao].resolvedPositions!.push({id: subPosition.icao, fir: 'airport'})
                context.airports[icao].positions!.push(subPosition)

                continue
            }

            context.airports[icao].resolvedPositions!.push(subPosition)
            context.airports[icao].positions!.push(subPosition)

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

        const sectorId = getId(id, 'sector', context);

        if (context.sectors[sectorId]) throw new Error(`Duplicate sector ${id} (${sectorId})`);

        context.sectors[sectorId] = {
            ...sector,

            division: context.currentDivision,
            subdivision: context.currentSubdivision ?? undefined,
            fir: context.currentFir!,

            volumes: sector.volumes.map(x => getId(x, 'volume', context)),
            positions: [],
            resolvedPositions: [],
        }

        for (let subPosition of sector?.positions ?? []) {
            if (typeof subPosition === 'string') subPosition = {id: subPosition}

            context.sectors[sectorId].resolvedPositions!.push(subPosition)
            context.sectors[sectorId].positions!.push(subPosition)
            context.leftovers.push({
                sector: context.sectors[sectorId],
                leftoverPosition: subPosition,
            })
        }
    }
}

export function processVolumes(volumes: Volumes, context: CompileContext) {
    for (const volume of volumes.features) {
        const volumeId = getId(volume.id, 'volume', context);

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
    const normalizedPosition = {
        ...position,
        id: getPositionId(position, context, currentFir)!,
    }

    if (foundPosition.parent) {
        return [
            normalizedPosition,
            ...findReferencesRecursive(foundPosition.parent, context, visited, foundPosition.fir ?? null),
        ];
    } else return [normalizedPosition];
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
            if (!('positions' in owner)) {
                const position = owner as PositionDefinitionCompiled
                if (!position.parent) continue

                if (!('icao' in position.parent)) {
                    position.parent.id = getPositionId(position.parent, context, context.currentFir)!
                    position.resolvedParent = findReferencesRecursive(position.parent, context, visited)
                }

                continue
            }

            const originalPositions = owner.positions ?? [];
            owner.positions = originalPositions.map(position => {
                if ('icao' in position) return position

                return {
                    ...position,
                    id: getPositionId(position, context, context.currentFir)!,
                }
            });
            owner.resolvedPositions = originalPositions.flatMap(position =>
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
