import type {Feature, FeatureCollection, MultiPolygon, Polygon, Position,} from 'geojson';

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
    suffixes?: string[];
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
    icao: string;
    runways?: RunwayDefinition[];
    resolvedPositions?: PositionReference[];

    division: string;
    subdivision?: string;
    fir: string;

    positions?: Array<PositionReference | { icao: string }>;
}

export interface Airports {
    $schema?: string;

    [icao: string]: Airport | string | undefined;
}

export interface Subdivision {
    name: string;
    briefing?: string;
    callsigns?: CallsignDefinition[];
    configuration?: Configuration
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
    configuration: Configuration;
    firs: Record<string, {
        configuration: Configuration
    }>
}

export interface PositionDefinition {
    suffixes: string[];
    prefixes: string[];
    name?: string;
    callsign?: string;
    parent?: string;
    label?: string;
    labelCoordinate?: Position;
    frequency?: number;
}

export interface PositionDefinitionCompiled extends Omit<PositionDefinition, 'parent'> {
    id: string;
    parent?: PositionReference;
    resolvedParent?: PositionReference[];
    division: string;
    subdivision?: string;
    fir?: string;
    sectors: string[];
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

export type ShowExtensionFrequency = 'always' | 'when-in-atis' | 'never';

export interface ExtensionDefaults {
    showExtensionFrequency?: ShowExtensionFrequency;
    frequencyRequired?: boolean;
    prefixes?: string[];
    suffixes?: Array<'CTR' | 'APP' | 'DEP'>;
}

export interface ExtensionMapping {
    identifier: string;
    frequency?: number;
    sectors: Array<string | SectorReference>;
}

export interface SectorReference {
    id: string;
    fir?: string;
}

export interface ExtensionConfiguration extends ExtensionDefaults {
    mapping?: ExtensionMapping[];
}

export interface OwnershipRule {
    volumes?: string[];
    positions?: Array<string | PositionReference>;
    resolvedPositions?: PositionReference[];
}

export interface AirportOwnershipRule {
    positions?: Array<string | PositionReference | { icao: string }>;
    resolvedPositions?: PositionReference[];
}

export interface OwnershipConfiguration {
    sectors?: Record<string, OwnershipRule>;
    airports?: Record<string, AirportOwnershipRule>;
}

export interface Configuration {
    $schema?: string;
    extensionsDefaults?: ExtensionDefaults;
    extensions?: ExtensionConfiguration[];
    ownership?: Record<string, OwnershipConfiguration>;
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
    id: string;
    resolvedPositions: PositionReference[];

    division: string;
    subdivision?: string;
    fir: string;

    /**
     * @description Positions before extended with proper positions tree
     */
    positions: PositionReference[];
}

export interface Sectors {
    $schema?: string;

    [id: string]: Sector | string | undefined;
}

export interface VolumeUnitDefinition {
    value: number;
    unit: 'FL' | 'ft';
}

export interface VolumeProperties {
    floor: VolumeUnitDefinition | number;
    ceiling: VolumeUnitDefinition | number;
    geometryFromVolume?: string;
}

export interface VolumePropertiesCompiled extends Omit<VolumeProperties, 'floor' | 'ceiling'> {
    floor: VolumeUnitDefinition;
    ceiling: VolumeUnitDefinition;
}

export type Volume = Feature<Polygon | MultiPolygon | null, VolumeProperties> & {
    id: string;
};

export type VolumeCompiled = Feature<Polygon | MultiPolygon | null, VolumePropertiesCompiled> & {
    id: string;
};

export type Volumes = Omit<
    FeatureCollection<Polygon | MultiPolygon | null, VolumeProperties>,
    'features'
> & {
    features: Volume[];
};
