import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {divisionsFolder, utilsRoot} from './utils/index.ts';
import {migrate, validateMigrationConfig, type MigrationConfig, type SimAwareData} from './utils/migration.ts';

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {headers: {'User-Agent': 'open-map-data-migration', 'Accept': 'application/json'}});
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
    return response.json() as Promise<T>;
}

async function getText(url: string): Promise<string> {
    const response = await fetch(url, {headers: {'User-Agent': 'open-map-data-migration'}});
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
    return response.text();
}

const config = JSON.parse(readFileSync(join(utilsRoot, 'migration.json'), 'utf8')) as MigrationConfig;

// Validate the requested divisions before making any network requests.
validateMigrationConfig(config, divisionsFolder);

const [map, release] = await Promise.all([
    getJson<{vatspy_dat_url: string; fir_boundaries_geojson_url: string}>('https://api.vatsim.net/api/map_data/'),
    getJson<{assets: Array<{name: string; browser_download_url: string}>}>('https://api.github.com/repos/vatsimnetwork/simaware-tracon-project/releases/latest'),
]);
const simawareUrl = release.assets?.find(asset => asset.name === 'TRACONBoundaries.geojson')?.browser_download_url;
if (!simawareUrl) throw new Error('SimAware TRACONBoundaries.geojson asset not found');

const [dat, boundaries, simaware] = await Promise.all([
    getText(map.vatspy_dat_url),
    getJson<unknown>(map.fir_boundaries_geojson_url),
    getJson<SimAwareData>(simawareUrl),
]);

console.log(migrate(config, divisionsFolder, dat, boundaries, simaware));
