import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
    Position,
} from 'geojson';

export interface PositionReference {
    id: string;
    /** Position belongs to another FIR. */
    fir?: string;
}

export interface CallsignDefinition {
    prefixes?: string[];
    suffixes?: string[];
    callsign: string;
}

export interface AirportCallsignDefinition {
    prefixes?: string[];
    suffixes: string[];
    callsign: string;
}

export type Approach =
    | 'VISUAL'
    | 'NDB'
    | 'VOR'
    | 'LOC'
    | 'LNAV'
    | 'LNAV_VNAV'
    | 'LPV'
    | 'RNP'
    | 'GLS'
    | 'ILS_CAT_I'
    | 'ILS_CAT_II'
    | 'ILS_CAT_IIIA'
    | 'ILS_CAT_IIIB'
    | 'ILS_CAT_IIIC';

export interface RunwayDefinition {
    name: string;
    similar?: string;
    course?: number;
    widthMeters?: number;
    lengthMeters?: number;
    approach?: Approach;
    approachFrequency?: number;
}

export interface Airport {
    name: string;
    iata?: string;
    faaLid?: string;
    city?: string;
    coordinate: Position;
    prefixes?: string[];
    positions?: Array<PositionReference | { icao: string } | string>;
    callsigns?: AirportCallsignDefinition[];
    elevationFt?: number;
    briefing?: string;
    ctaf?: string;
    runways?: Array<string | RunwayDefinition>;
}

export interface AirportCompiled extends Omit<Airport, 'runways' | 'positions'> {
    runways?: RunwayDefinition[];
    positions?: PositionReference[];

    division: string;
    subdivision?: string;
    fir: string;

    /**
     * @description Positions before they got normalized
     */
    _positions?: Array<PositionReference | { icao: string }>;
}

export interface Airports {
    $schema?: string;

    [icao: string]: Airport | string | undefined;
}

export interface Subdivision {
    name: string;
    briefing?: string;
}

export interface Country {
    name: string;
    prefixes: string[];
}

export interface Division {
    $schema?: string;
    code: string;
    name: string;
    region: string;
    briefing?: string;
    subdivisions?: Record<string, Subdivision>;
    countries?: Country[];
    callsigns?: CallsignDefinition[];
}

export interface PositionDefinition {
    type: string;
    prefix: string | string[];
    name?: string;
    callsign?: string;
    positions?: Array<string | PositionReference>;
    label?: string;
    labelCoordinate?: Position;
    frequency?: number;
}

export interface PositionDefinitionCompiled extends Omit<PositionDefinition, 'positions'> {
    positions?: PositionReference[]
    _positions?: PositionReference[]
    owns: string[];
    division: string;
    subdivision?: string;
    fir?: string;
}

export interface Positions {
    $schema?: string;

    [id: string]: PositionDefinition | string | undefined;
}

export interface RunwayConfiguration {
    airport: string;
    runway?: string;
}

export interface TimeConfigurationStart {
    /** Day of week, Monday = 1. */
    dateIndex?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    hour: number;
    minute?: number;
}

export interface TimeConfiguration {
    start: TimeConfigurationStart;
    end: TimeConfigurationStart;
}

export interface Sector {
    volumes: string[];
    positions: Array<string | PositionReference>;
    name?: string;
    runwayConfig?: RunwayConfiguration[];
    timeConfig?: TimeConfiguration[];
    label?: string;
    labelCoordinate?: Position;
}

export interface SectorCompiled extends Omit<Sector, 'positions'> {
    positions: PositionReference[];

    division: string;
    subdivision?: string;
    fir: string;

    /**
     * @description Positions before extended with proper positions tree
     */
    _positions: PositionReference[];
}

export interface Sectors {
    $schema?: string;

    [id: string]: Sector | string | undefined;
}

export interface VolumeProperties {
    floor: number;
    ceiling: number;
}

export type Volume = Feature<Polygon | MultiPolygon, VolumeProperties> & {
    id: string;
};

export type Volumes = Omit<
    FeatureCollection<Polygon | MultiPolygon, VolumeProperties>,
    'features'
> & {
    features: Volume[];
};
