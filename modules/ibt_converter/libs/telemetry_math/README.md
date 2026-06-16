# iRacing Telemetry Math

A lightweight JavaScript module for performing statistical analysis and feature extraction on iRacing telemetry signals.

## Features

- **Standard Statistics**: Mean, Standard Deviation, and Percentiles (p05, p95).
- **Signal Modulation**: Calculation of rate-of-change statistics for input signals (throttle, brake, steering).
- **Correlation**: Pearson correlation coefficient between any two telemetry channels.
- **Efficiency Metrics**: Normalization of dynamics (accel, yaw) against vehicle speed.

## Usage

```javascript
// const stats = TelemetryMath.calculateStats(throttleData);
// const corr = TelemetryMath.calculatePearsonCorrelation(brakeData, longAccelData);
```

## License

MIT

