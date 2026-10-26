import {join} from "node:path";
import {existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync} from "node:fs";
import type {
    AirportCompiled,
    Configuration,
    Division,
    ExtensionMapping,
    PositionDefinitionCompiled,
    PositionReference,
    SectorCompiled,
    VolumeCompiled
} from "shared/types";
import {checkSchema, divisionsFolder, internalRoot} from "./index.ts";
import {
    processAirports,
    processLeftovers,
    processPositions,
    processSectors,
    processVolumes,
    compileVatSpy,
    compileFirBoundaries,
    validateVatSpyReferences,
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
    volumes: Record<string, VolumeCompiled>

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
    } | {
        ownership: Configuration['ownership'];
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
            context.divisions[context.currentDivision]!.subdivisions![context.currentSubdivision]!.configuration = checkSchema('configuration', JSON.parse(readFileSync(join(context.currentPath, 'configuration.json'), 'utf-8')), context.validate)
            config = context.divisions[context.currentDivision]!.subdivisions![context.currentSubdivision]!.configuration
        } else {
            context.divisions[context.currentDivision]!.configuration = checkSchema('configuration', JSON.parse(readFileSync(join(context.currentPath, 'configuration.json'), 'utf-8')), context.validate)
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
        if (config?.ownership) context.leftovers.push({
            ownership: config.ownership,
            division: context.currentDivision,
            subdivision: context.currentSubdivision ?? undefined,
            fir: context.currentFir ?? undefined,
        })
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
            context.divisions[context.currentDivision]!.firs[fir].configuration = checkSchema('configuration', JSON.parse(readFileSync(join(context.currentPath, 'configuration.json'), 'utf-8')), context.validate)

            if (context.divisions[context.currentDivision]!.firs[fir].configuration.extensionsDefaults && context.divisions[context.currentDivision]!.firs[fir].configuration.extensions?.length) {
                context.divisions[context.currentDivision]!.firs[fir].configuration.extensions!.forEach((x) => {
                    Object.assign(x, context.divisions[context.currentDivision]!.firs[fir].configuration.extensionsDefaults!)
                })
            }

            const config = context.divisions[context.currentDivision]!.firs[fir].configuration
            if (config.ownership) context.leftovers.push({
                ownership: config.ownership,
                division: context.currentDivision,
                subdivision: context.currentSubdivision ?? undefined,
                fir,
            })
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
        const division = checkSchema('divisions', JSON.parse(readFileSync(join(divisionsFolder, divisionCode, 'division.json'), 'utf-8')), validate);

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

        mkdirSync(join(internalRoot, 'dist'), {recursive: true});

        writeFileSync('dist/airports.json', JSON.stringify(context.airports, undefined, 2))

        writeFileSync('dist/data.json', JSON.stringify({
            divisions: context.divisions,
            positions: context.positions,
            sectors: context.sectors,
        }, undefined, 2))

        writeFileSync('dist/volumes.json', JSON.stringify(context.volumes, undefined, 2))
        writeFileSync('dist/volumes.geojson', JSON.stringify({
            type: 'FeatureCollection',
            name: 'Volumes',
            features: Object.values(context.volumes),
        }, undefined, 2))

        const vatSpy = compileVatSpy(context);
        const firBoundariesDat = compileFirBoundaries(vatSpy.boundaries);
        validateVatSpyReferences(vatSpy.dat, vatSpy.boundaries, firBoundariesDat);
        writeFileSync('dist/Boundaries.geojson', JSON.stringify(vatSpy.boundaries, undefined, 2));
        writeFileSync('dist/FIRBoundaries.dat', firBoundariesDat, 'utf-8');
        writeFileSync('dist/VATSpy.dat', vatSpy.dat, 'utf-8');
    }
}
