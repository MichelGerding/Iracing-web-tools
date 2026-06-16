# iRacing IBT Parser

A lightweight, high-performance JavaScript parser for iRacing telemetry (`.ibt`) files.

## Features

- **Full Header Parsing**: Extracts telemetry and disk headers.
- **Variable Metadata**: Access all telemetry channel definitions (names, units, types).
- **Session Info**: Includes a custom YAML parser to extract session metadata.
- **High Performance**: Uses TypedArrays and columnar extraction for fast data access.
- **Zero Dependencies**: Self-contained parsing logic.

## Usage

```javascript
// Load the scripts or import them
// const ibt = parseIBT(arrayBuffer);
// console.log(ibt.data);
```

## Structure

- `parser.js`: The core IBT parsing logic.
- `parse_yaml.js`: A lightweight YAML parser for session metadata.

## License

MIT

