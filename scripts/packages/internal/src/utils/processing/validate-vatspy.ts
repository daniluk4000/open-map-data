import type {FeatureCollection, MultiPolygon, Polygon} from "geojson";

export function validateVatSpyReferences(
    vatSpyDat: string,
    boundaries: FeatureCollection<Polygon | MultiPolygon>,
    firBoundariesDat: string,
): void {
    const geojsonIds = new Set(boundaries.features.map(feature => String(feature.properties?.id)));
    const datIds = new Set(firBoundariesDat.split(/\r?\n/)
        .filter(line => line.split('|').length === 10)
        .map(line => line.split('|', 1)[0]!));
    const firIds = new Set<string>();
    const firBoundaries = new Set<string>();
    const airportFirs = new Set<string>();
    const uirFirs = new Set<string>();
    let section = '';

    for (const line of vatSpyDat.split('\n')) {
        if (line.startsWith('[')) {
            section = line;
        } else if (line && !line.startsWith(';')) {
            const fields = line.split('|');
            if (section === '[FIRs]') {
                firIds.add(fields[0]!);
                firBoundaries.add(fields[3]!);
            } else if (section === '[Airports]' && fields[5]) {
                airportFirs.add(fields[5]);
            } else if (section === '[UIRs]') {
                for (const id of fields[2]?.split(',') ?? []) if (id) uirFirs.add(id);
            }
        }
    }

    const mismatches: Array<[string, string[]]> = [
        ['FIRs without GeoJSON boundary', [...firBoundaries].filter(id => !geojsonIds.has(id))],
        ['FIRs without DAT boundary', [...firBoundaries].filter(id => !datIds.has(id))],
        ['GeoJSON boundaries without DAT boundary', [...geojsonIds].filter(id => !datIds.has(id))],
        ['DAT boundaries without GeoJSON boundary', [...datIds].filter(id => !geojsonIds.has(id))],
        ['UIRs with unknown FIR', [...uirFirs].filter(id => !firIds.has(id))],
    ].filter(([, ids]) => ids.length);

    if (mismatches.length) {
        throw new Error(`Inconsistent VAT-Spy data: ${mismatches.map(([kind, ids]) => `${kind}: ${ids.join(', ')}`).join('; ')}`);
    }
}
