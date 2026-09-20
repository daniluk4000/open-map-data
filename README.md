# Open Map Data proposal

## Backwards compatibility and combined mode

This dataset introduces compatibility for programs that use VATSpy and SimAware TRACON datasets, as well as native
support for combined mode.

The only requirement is that at least one sector volume must have 000-999 vertical border.

Otherwise, it will not be shown on maps that have altitude display disabled, or will not be included for backwards
compatibility.

When 000-999 volume is present, and sector has other volumes, 000-999 volume (s) will only be used in case altitude
display is disabled.

It is recommended to have at least one 000-999 volume, unless your sector should not be displayed unless altitude
display is enabled.

## Build-time improvements

This dataset is improved build time:

- Airports and Sectors' positions are extended with whole `parent` hierarchy, or with other airport's hierarchy. In
  build file, a new field named `resolvedPositions` will be present that includes recursive references to other FIRs and
  airports.
- Most structures are enriched with `division`, `subdivision` and `fir` fields
- Configuration is added to Division root for easy lookup
- All IDs are replaced with globally uniqued IDs (type:fir/id). Ex. `ULLI-APP` sector in ULLL FIR will have an ID of `sector:ULLL/ULLI-APP`
- For each position a `sectors` array is also produced, containing all sectors that this sector can possibly own

## The Idea

The idea is for this dataset to be as performant as possible.

Example lookup strategy:
1. Since each position has prefix, find a position with longest `prefix` and correct `type` (ex. both ULLI_ and ULLI_R resolve for ULLI_R_APP, but since ULLI_R prefix is longer, you must use this)
2. In case position has a required frequency, verify it as well
3. Based on `sectors` field, find all `sectors` that can be for this position. Verify their time and runway configurations, as well as if no "higher" position owns this sector already
4. Lookup for `sectors` volumes and compare their `floor`/`ceiling` to user's altitude. In case volume is 000-999, it can be shown if no altitude is selected

So basically:
- Position is a specific controller that can own sectors. For example, ULLL_CTR
- Sector is a combination of volumes. For example, ULLL_R1-R6_CTR
- Volume is a piece of airspace that can have vertical borders

## File Structure

Whole structure is Division-based, following Division → Subdivision → FIR.

Each Division folder can contain such files:

- index.json
- configuration.json
- positions.json

Each Subdivision folder can contain such files:

- positions.json
- configuration.json

Each FIR folder can contain such files:

- airports.json
- positions.json
- sectors.json
- volumes.geojson
- configuration.json

### Division's index.json

Contains whole Division definition. Can only be present in root of division folder.

- `code` (required): Division code. For example, EUD
- `name` (required): Division name. For example, Europe (except UK)
- `region` (required): Division region. For example, EMEA
- `briefing`: Division website briefing link. Will be shown (on map decisions) for all airports without a briefing
- `subdivisions`: an object with `name`, `briefing` and `callsigns` fields. Filling this will enforce subdivisions
  folder structure, with each folder named as specific subdivision code
- `countries`: Countries prefixes definitions for airports in this division (array of `name` and `prefixes`)
- `callsigns`: Callsigns definitions for all matching positions in this division. For example, you can set all Grounds
  to be Aprons by default - etc

### Configuration (.json)

That file can be present in any directory. An object that can contain Division or FIR-level configuration.

Supported fields:

- `extensionsDefaults`: an object of `showExtensionFrequency`, `frequencyRequired`, `prefixes` and `suffixes` that is
  applied automatically to all extensions
- `extensions`: ATIS-based CTR or APP extensions of other sectors. An array of objects:
    - `showExtensionFrequency`. Changes frequency in case of extension. When when-in-atis selected, frequency will only
      be changed if correct sector frequency is in ATIS. Supported values:
        - `always`. Frequency is always changed to extension sector frequency
        - `when-in-atis`: Frequency only changes when extension sector frequency is in ATIS
        - `never`: Frequency never changes (default value)
    - `frequencyRequired`: Requires frequency to be in ATIS for extension to happen. Depending on above setting,
      extension frequency or primary frequency is required
    - `prefixes`: Prefixes of positions that are allowed to use extensions
    - `suffixes`: Suffixes of positions that are allowed to use extensions. Can only be `CTR`, `APP` or `DEP` (defaults
      to all 3 of these)
    - `mapping`: an array of ATIS-to-position mapping
        - `identifier` (required): ID that should be in ATIS for extension to take place (ex. `ARL`, `Area A`)
        - `frequency`: Frequency that must follow identifier in ATIS. Example ATIS for frequency `127100000` would be
          `Extending ARL 127.100`
        - `sectors` (required): Sectors in current FIR or Division to extend. Note that sector cannot be extended by
          more than one mapping rule, and is only extended if nobody else is owning this sector currently. Can be an
          object that specifies which FIR to extend

### Positions (.json)

Creates definitions for positions. When present in root of (sub)division, allows to define FSS.

Supported fields:

- `name`: Position name. For example, Peterburg
- `callsign`: Position callsign. For example, Peterburg Control. Defaults to division callsign definitions
- `label`: Optional label, displayed on map. Defaults to position ID
- `labelCoordinate`: Optional label coordinate. Defaults to all (or each) sectors center. When specified, only one label
  will be displayed for this sector
- `type` (required): Position type (suffix). For example, CTR
- `prefix` (required): Position prefix, or prefixes
- `frequency`: Position primary frequency. When unspecified, any frequency will be valid for this position
- `parent`: A larger parent position that fully includes this position

### Sectors (.json)

Creates definitions for sectors, that are groups of different volumes and owning positions. One position can own many
sector, but each sector can only be owned by one position at a time.

Supported fields:

- `name`: Sector name
- `volumes` (required): a list of volumes that this sector contains
- `positions` (required): a list of owning positions. Can be an object in case other FIR position owns this sector
- `runwayConfig`: runway configuration that is required for this sector to be shown
- `timeConfig`: time that this sector should be shown on map
- `label`: Optional label, displayed on map. Defaults to sector ID
- `labelCoordinate`: Optional label coordinate. Defaults to sector center
- `oceanic`: is this sector oceanic

### Volumes (.geojson)

Geojson that contains all volumes for a FIR. An ID is required for each sector.

Geojson properties must also include:

- `floor`: FL of lower vertical border (inclusive). Set to 000 to have no lower level
- `ceiling`: FL of upper vertical border (exclusive). Set to 999 to have no upper level

With `floor` set to 999 and `ceiling` set to 000, enables this volume for combined display and VATSpy compatibility.

### Airports (.json)

Airports definitions. An object (key = ICAO code)

- `name` (required): Airport Name
- `iata`: IATA code
- `faaLid`: FAA LID
- `city`
- `coordinate` (required)
- `prefixes`: Globally unique airport prefixes if different from ICAO code
- `positions`: List of owning positions in descending order (first has the most priority to control this sector). Can
  also inherit this from other airport
- `callsigns`: Callsigns definitions for all matching positions in this airport, if different from division definition
- `elevationFt`: Airport elevation in feets
- `briefing`: This airport briefing link
- `ctaf`: Airport CTAF frequency
- `runways`: Runways configuration
    - `name`
    - `similar`
    - `course`
    - `widthMeters`
    - `lengthMeters`
    - `approach`: Lowest minima (ex. ILS_CAT_IIIA)
    - `approachFrequency`
