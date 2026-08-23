import {join} from "node:path";
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import type {
    AirportCompiled,
    Division,
    PositionDefinition,
    PositionDefinitionCompiled, PositionReference,
    SectorCompiled,
    Volume
} from "../types/index.ts";
import {checkSchema, divisionsFolder, schemaFolder} from "./index.ts";
import {processAirports, processLeftovers, processPositions, processSectors, processVolumes} from "./processing/index.ts";

const divisions: Record<string, Division> = {}

export interface CompileSettings {
    validate?: boolean
}

export interface CompileContext extends CompileSettings {
    // State
    currentPath: string;
    currentDivision: string
    currentSubdivision: string | null
    currentFir: string | null
    airportIata: Set<string>,
    airportFaa: Set<string>,
    airportPrefixes: Set<string>,

    // Final state
    divisions: Record<string, Division>
    positions: Record<string, PositionDefinitionCompiled>
    airports: Record<string, AirportCompiled>
    sectors: Record<string, SectorCompiled>
    volumes: Record<string, Volume>

    // State enrichment after calculations
    leftovers: Array<{
        position: PositionDefinitionCompiled
        leftoverPosition: PositionReference
    } | {
        airport: AirportCompiled
        leftoverPosition?: PositionReference
        leftoverAirport?: string
    } | {
        sector: SectorCompiled
        leftoverPosition: PositionReference
    }>
}

export function compileDirectory(context: CompileContext) {
    const path = context.currentPath

    for (const fir of readdirSync(path)) {
        context.currentFir = fir;
        context.currentPath = join(path, fir);

        if (existsSync(join(context.currentPath, 'positions.json'))) {
            const result = checkSchema('positions', JSON.parse(readFileSync(join(context.currentPath, 'positions.json'), 'utf-8')), context.validate);
            processPositions(result, context)
        }

        if (existsSync(join(context.currentPath, 'airports.json'))) {
            const result = checkSchema('airports', JSON.parse(readFileSync(join(context.currentPath, 'airports.json'), 'utf-8')), context.validate);
            processAirports(result, context)
        }

        if (existsSync(join(context.currentPath, 'sectors.json'))) {
            const result = checkSchema('sectors', JSON.parse(readFileSync(join(context.currentPath, 'sectors.json'), 'utf-8')), context.validate);
            processSectors(result, context)
        }

        if (existsSync(join(context.currentPath, 'volumes.geojson'))) {
            const result = checkSchema('volumes', JSON.parse(readFileSync(join(context.currentPath, 'volumes.geojson'), 'utf-8')), context.validate);
            processVolumes(result, context)
        }
    }

    context.currentFir = null
    context.currentPath = path
}

export function compileAllSet(settings: CompileSettings = {}) {
    const context: CompileContext = {
        airportFaa: new Set(),
        airportIata: new Set(),
        airportPrefixes: new Set(),
        currentPath: divisionsFolder,
        currentDivision: '',
        currentSubdivision: null,
        currentFir: null,
        divisions: {},
        positions: {},
        airports: {},
        sectors: {},
        volumes: {},
        leftovers: []
    }

    const {validate} = settings

    for (const divisionCode of readdirSync(divisionsFolder)) {
        const division = checkSchema('divisions', JSON.parse(readFileSync(join(divisionsFolder, divisionCode, 'index.json'), 'utf-8')), validate);

        divisions[division.code] = division

        context.currentPath = join(divisionsFolder, divisionCode)
        context.currentDivision = divisionCode
        context.currentSubdivision = null
        context.currentFir = null

        if (existsSync(join(context.currentPath, 'positions.json'))) {
            const positions = checkSchema('positions', JSON.parse(readFileSync(join(context.currentPath, 'positions.json'), 'utf-8')), validate);
            processPositions(positions, context)
        }

        let pass = false;

        if (division.subdivisions) {
            for (const subdivision in division.subdivisions) {
                pass = true;
                context.currentSubdivision = subdivision
                const path = join(context.currentPath, subdivision)

                if (existsSync(path)) {
                    context.currentPath = path;

                    const positions = checkSchema('positions', JSON.parse(readFileSync(join(context.currentPath, 'positions.json'), 'utf-8')), validate);
                    processPositions(positions, context)

                    compileDirectory(context);
                }
            }
        }

        context.currentPath = join(divisionsFolder, divisionCode)

        // FIRs lookup in current directory, ignoring other files if present
        if (!pass) compileDirectory(context)

        processLeftovers(context);

        writeFileSync('result.json', JSON.stringify({
            divisions: context.divisions,
            positions: context.positions,
            airports: context.airports,
            sectors: context.sectors,
            volumes: context.volumes,
        }))
    }
}