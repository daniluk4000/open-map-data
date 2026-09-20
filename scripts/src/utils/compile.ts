import {join} from "node:path";
import {Dirent, existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import type {
    AirportCompiled, Configuration,
    Division, ExtensionConfiguration, ExtensionMapping,
    PositionDefinitionCompiled, PositionReference,
    SectorCompiled,
    Volume
} from "../types/index.ts";
import {checkSchema, divisionsFolder, schemaFolder} from "./index.ts";
import {
    processAirports,
    processLeftovers,
    processPositions,
    processSectors,
    processVolumes
} from "./processing/index.ts";

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
    firs: Set<string>
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
    } | {
        config: ExtensionMapping

        division: string;
        subdivision?: string;
        fir?: string;
    }>
}

export function compileDirectory(context: CompileContext) {
    const path = context.currentPath

    if (existsSync(join(context.currentPath, 'configuration.json'))) {
        let config: Configuration | undefined

        if (context.currentSubdivision) {
            context.divisions[context.currentDivision]!.subdivisions![context.currentSubdivision]!.configuration = JSON.parse(readFileSync(join(context.currentPath, 'configuration.json'), 'utf-8'))
            config = context.divisions[context.currentDivision]!.subdivisions![context.currentSubdivision]!.configuration
        } else {
            context.divisions[context.currentDivision]!.configuration = JSON.parse(readFileSync(join(context.currentPath, 'configuration.json'), 'utf-8'))
            config = context.divisions[context.currentDivision]!.configuration
        }

        if (config && config.extensionsDefaults && config.extensions?.length) {
            config.extensions!.forEach((x) => {
                Object.assign(x, config.extensionsDefaults!)
            })
        }

        for (const extension of config?.extensions ?? []) {
            for (const mapping of extension.mapping ?? []) {
                context.leftovers.push({
                    config: mapping,
                    division: context.currentDivision,
                    subdivision: context.currentSubdivision ?? undefined,
                    fir: context.currentFir ?? undefined,
                })
            }
        }
    }

    for (const dir of readdirSync(path, {withFileTypes: true})) {
        if (!dir.isDirectory()) continue
        const fir = dir.name

        if (context.firs.has(fir)) {
            throw new Error(`Duplicate FIR ${fir} (${context.currentDivision}/${fir})`)
        }
        context.firs.add(fir)

        context.currentFir = fir;
        context.currentPath = join(path, fir);
        context.divisions[context.currentDivision]!.firs ??= {}
        context.divisions[context.currentDivision]!.firs[fir] = {configuration: {}}

        if (existsSync(join(context.currentPath, 'configuration.json'))) {
            context.divisions[context.currentDivision]!.firs[fir].configuration = JSON.parse(readFileSync(join(context.currentPath, 'positions.json'), 'utf-8'))

            if (context.divisions[context.currentDivision]!.firs[fir].configuration.extensionsDefaults && context.divisions[context.currentDivision]!.firs[fir].configuration.extensions?.length) {
                context.divisions[context.currentDivision]!.firs[fir].configuration.extensions!.forEach((x) => {
                    Object.assign(x, context.divisions[context.currentDivision]!.firs[fir].configuration.extensionsDefaults!)
                })
            }
        }

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
        firs: new Set(),
        divisions: {},
        positions: {},
        airports: {},
        sectors: {},
        volumes: {},
        leftovers: [],
    }

    settings.validate ??= true
    const {validate} = settings
    context.validate = validate;

    for (const divisionCode of readdirSync(divisionsFolder)) {
        const division = checkSchema('divisions', JSON.parse(readFileSync(join(divisionsFolder, divisionCode, 'index.json'), 'utf-8')), validate);

        delete division.$schema;
        context.divisions[divisionCode] = division;

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
        }, undefined, 2))
    }
}
