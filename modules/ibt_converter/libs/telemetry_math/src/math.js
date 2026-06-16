"use strict";

/**
 * @typedef {Object} ChannelStats
 * @property {number} mean - Arithmetic mean
 * @property {number} std - Standard deviation
 * @property {number} p05 - 5th percentile
 * @property {number} p95 - 95th percentile
 */

/**
 * @typedef {Object} ModulationStats
 * @property {number} modMean - Mean rate of change
 * @property {number} modStd - Standard deviation of rate of change
 */

/**
 * Telemetry mathematics and statistics module.
 * Provides functions for signal processing and feature extraction.
 */
const TelemetryMath = (() => {
  /**
   * Computes basic statistics (mean, std, p05, p95) for a numeric array.
   * @param {number[]|TypedArray} data - The input data
   * @returns {ChannelStats}
   */
  function calculateStats(data) {
    if (data.length === 0) return { mean: 0, std: 0, p05: 0, p95: 0 };
    const n = data.length;
    const mean = data.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(
      data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n,
    );
    const sorted = [...data].sort((a, b) => a - b);
    const p05 = sorted[Math.floor(n * 0.05)] || 0;
    const p95 = sorted[Math.floor(n * 0.95)] || 0;

    return { mean, std, p05, p95 };
  }

  /**
   * Computes modulation (rate of change) statistics for a signal.
   * @param {number[]|TypedArray} data - The input data
   * @returns {ModulationStats}
   */
  function calculateModulation(data) {
    if (data.length < 2) return { modMean: 0, modStd: 0 };
    const diffs = [];
    for (let i = 1; i < data.length; i++) {
      diffs.push(Math.abs(data[i] - data[i - 1]));
    }
    const n = diffs.length;
    const modMean = diffs.reduce((a, b) => a + b, 0) / n;
    const modStd = Math.sqrt(
      diffs.reduce((a, b) => a + Math.pow(b - modMean, 2), 0) / n,
    );

    return { modMean, modStd };
  }

  /**
   * Computes Pearson correlation coefficient between two arrays.
   * @param {number[]|TypedArray} a - First array
   * @param {number[]|TypedArray} b - Second array
   * @returns {number} Correlation coefficient (-1 to 1)
   */
  function calculatePearsonCorrelation(a, b) {
    if (a.length !== b.length || a.length === 0) return 0;
    const n = a.length;
    const meanA = a.reduce((x, y) => x + y, 0) / n;
    const meanB = b.reduce((x, y) => x + y, 0) / n;

    let num = 0;
    let denA = 0;
    let denB = 0;

    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }

    const den = Math.sqrt(denA * denB);
    return den > 0 ? num / den : 0;
  }

  /**
   * Computes effective dynamics relative to Speed (e.g., LatAccel/Speed).
   * @param {number[]|TypedArray} channelData - Dynamics data (e.g. YawRate)
   * @param {number[]|TypedArray} speedData - Speed data
   * @param {number} [eps=1e-6] - Small constant to avoid div by zero
   * @returns {number} Mean efficiency
   */
  function calculateEfficiency(channelData, speedData, eps = 1e-6) {
    const n = channelData.length;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += channelData[i] / (speedData[i] + eps);
    }
    return sum / n;
  }

  return {
    calculateStats,
    calculateModulation,
    calculatePearsonCorrelation,
    calculateEfficiency,
  };
})();

if (typeof module !== "undefined") module.exports = TelemetryMath;
if (typeof window !== "undefined") window.TelemetryMath = TelemetryMath;

