import {join} from "node:path";
import {fileURLToPath} from "url";
import {readdirSync, readFileSync} from "node:fs";
import Ajv from "ajv/dist/2020.js";
import {
    AirportCompiled,
    Division,
    PositionDefinition,
    PositionDefinitionCompiled,
    SectorCompiled,
    Volume
} from "../types";
import {checkSchema, divisionsFolder, schemaFolder} from "./index.ts";

const __dirname = fileURLToPath(new URL(import.meta.url).toString());
const ajv = new Ajv()

const divisions: Record<string, Division> = {}

export interface CompileSettings {
    validate?: boolean
}

export interface CompileContext extends CompileSettings {
    currentPath: string;
    divisions: Record<string, Division>
    positions: Record<string, PositionDefinitionCompiled>
    airports: Record<string, AirportCompiled>
    sectors: Record<string, SectorCompiled>
    volumes: Record<string, Volume>
}

export function compileDirectory(path: string, context: CompileContext) {

}

export function compileAllSet(settings: CompileSettings = {}) {
    const context: CompileContext = {
        currentPath: divisionsFolder,
        divisions: {},
        positions: {},
        airports: {},
        sectors: {},
        volumes: {},
    }

    const {validate} = settings

    for (const divisionCode of readdirSync(divisionsFolder)) {
        const division = checkSchema('divisions', JSON.parse(readFileSync(join(divisionsFolder, divisionCode, 'index.json'), 'utf-8')), validate);

        divisions[division.code] = division


    }
}