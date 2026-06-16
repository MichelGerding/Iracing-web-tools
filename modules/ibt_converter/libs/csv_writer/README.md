# IBT CSV Writer

A module for generating CSV files from iRacing `.ibt` telemetry data.

## Features

- **Background Processing**: Uses Web Workers to generate CSVs without freezing the browser UI.
- **Header Metadata**: Includes session metadata in the CSV header.
- **Columnar Data**: Exports all telemetry channels or a selected subset.
- **Progress Tracking**: Provides progress updates for large exports.

## Components

- `writer.js`: Contains the Web Worker source and helper functions for CSV generation and downloads.

## Usage

```javascript
// Use IBT_CSV_WORKER_SRC to create a Web Worker
const blob = new Blob([IBT_CSV_WORKER_SRC], { type: "application/javascript" });
const worker = new Worker(URL.createObjectURL(blob));

// Send data to worker and handle results
```

## License

MIT

