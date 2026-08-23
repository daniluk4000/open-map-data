import {join} from "node:path";
import {readFileSync} from "node:fs";
import Ajv from "ajv/dist/2020";
import {fileURLToPath} from "url";
import {
    Airport,
    Airports,
    Division,
    Group,
    Groups,
    PositionDefinition,
    Positions,
    Sector,
    Sectors,
    Volumes
} from "../types";

const __dirname = fileURLToPath(new URL(import.meta.url).toString());
export const utilsRoot = join(__dirname, '../../../../')
export const schemaFolder = join(utilsRoot, 'schema')
export const divisionsFolder = join(utilsRoot, 'divisions')

export const ajv = new Ajv()

export function checkSchema(schema: 'volumes', data: Record<string, any>, skip?: boolean): Volumes
export function checkSchema(schema: 'sectors', data: Record<string, any>, skip?: boolean): Sectors
export function checkSchema(schema: 'positions', data: Record<string, any>, skip?: boolean): Positions
export function checkSchema(schema: 'groups', data: Record<string, any>, skip?: boolean): Groups
export function checkSchema(schema: 'divisions', data: Record<string, any>, skip?: boolean): Division
export function checkSchema(schema: 'airports', data: Record<string, any>, skip?: boolean): Airports
export function checkSchema(schema: 'airports' | 'divisions' | 'groups' | 'positions' | 'sectors' | 'volumes', data: Record<string, any>, skip = false) {
    if (skip) return data;
    const compiledSchema = ajv.compile(JSON.parse(readFileSync(join(schemaFolder, 'divisions.json'), 'utf-8')))
    const valid = compiledSchema(data)

    if (!valid) {
        console.log(data)
        throw compiledSchema.errors;
    }

    return data;
}