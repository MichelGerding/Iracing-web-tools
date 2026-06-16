"use strict";


/**
 * Channel configuration for telemetry data
 */
const CHANNELS_DEFAULT = [
  "Throttle",
  "Brake",
  "SteeringWheelAngle",
  "LatAccel",
  "LongAccel",
  "YawRate",
  "Speed",
];

const FIXED_CHANNELS = ["Lap", "LapCurrentLapTime", "LapDistPct"];

/**
 * @typedef {Object} AppState
 * @property {File|null} file - The currently loaded file
 * @property {ArrayBuffer|null} buffer - The file's raw data
 * @property {DataView|null} dv - DataView for the buffer
 * @property {TelemetryHeader|null} telHdr - Parsed telemetry header
 * @property {DiskSubHeader|null} diskHdr - Parsed disk sub-header
 * @property {Map<string, VarHeader>|null} varMap - Map of variable headers
 * @property {any} sessionInfo - Parsed YAML session metadata
 * @property {number} sampleCount - Total number of samples in the file
 * @property {Set<string>} selectedChannels - Set of channel names selected for preview
 * @property {Object.<string, TypedArray|Array>|null} data - Columnar telemetry data
 */

/**
 * Global application state
 * Stores loaded file data and UI selections
 * @type {AppState}
 */
let state = {
  file: null,
  buffer: null,
  dv: null,
  telHdr: null, // Parsed telemetry header
  diskHdr: null, // Parsed disk sub-header
  varMap: null, // Map<name, varHeader>
  sessionInfo: "", // Session metadata (YAML)
  sampleCount: 0, // Number of samples
  selectedChannels: new Set(CHANNELS_DEFAULT),
  data: null, // All telemetry data is now pre-extracted
};


//  FILE LOADING

/**
 * Load and parse an IBT file
 * @async
 * @param {File} file - The .ibt file to load
 */
async function loadFile(file) {
  setStatus("loading", `Reading ${file.name}…`);
  showProgress(5);
  document.getElementById("emptyState").style.display = "none";

  // Read file into buffer
  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    setStatus("error", `Could not read file: ${e.message}`);
    return;
  }
  showProgress(20);

  // Use the complete parser
  let ibt;
  try {
    ibt = parseIBT(buf);
  } catch (e) {
    setStatus("error", `Parse failed: ${e.message}`);
    return;
  }
  showProgress(85);

  // Update state
  state.file = file;
  state.buffer = buf;
  state.dv = new DataView(buf);
  state.telHdr = ibt.header;
  state.diskHdr = ibt.diskHeader;
  state.varMap = ibt.varMap;
  state.sessionInfo = ibt.sessionInfo;
  state.sampleCount = ibt.sampleCount;
  state.data = ibt.data; // All telemetry data is now pre-extracted

  // Render UI
  renderMeta();
  renderPreview();

  showProgress(100);
  setTimeout(() => hideProgress(), 400);

  // Display success message
  const missing = FIXED_CHANNELS.filter((c) => !state.varMap.has(c));
  const warn = missing.length
    ? ` · ⚠ missing fixed: ${missing.join(", ")}`
    : "";
  setStatus(
    "ok",
    `Loaded — ${state.sampleCount.toLocaleString()} samples @ ${state.telHdr.tickRate} Hz · ${state.varMap.size} channels${warn}`,
  );

  document.getElementById("exportBtn").disabled = false;
  document.getElementById("exportFeaturesBtn").disabled = false;
  document.getElementById("metaSection").style.display = "block";
  document.getElementById("previewSection").style.display = "block";
}

//  UI STATE FUNCTIONS

/**
 * Update the status bar display
 * @param {string} type - Status type: 'idle', 'loading', 'ok', 'error'
 * @param {string} text - Status message
 */
function setStatus(type, text) {
  const bar = document.getElementById("statusBar");
  bar.className = `status-bar ${type}`;
  document.getElementById("statusText").textContent = text;
}

/**
 * Show and update the progress bar
 * @param {number} pct - Progress percentage (0-100)
 */
function showProgress(pct) {
  document.getElementById("progressSection").style.display = "block";
  document.getElementById("progressBar").style.width = `${pct}%`;
}

/**
 * Hide the progress bar
 */
function hideProgress() {
  document.getElementById("progressSection").style.display = "none";
}

//  FEATURE COMPUTATION

/**
 * Helper to compute telemetry features for a specific set of sample indices (a single lap)
 * @param {Array<number>} indices - The sample indices belonging to this lap
 * @returns {Object|null} Combined features and resolved lap duration
 */
function computeFeaturesForSampleIndices(indices) {
  const { data, telHdr, varMap } = state;
  const nSamples = indices.length;
  if (nSamples === 0) return null;

  const inputChannels = ["Throttle", "Brake", "SteeringWheelAngle"];
  const dynChannels = ["LatAccel", "LongAccel", "YawRate"];
  const allChannels = inputChannels.concat(dynChannels).concat(["Speed"]);

  // Collect pre-extracted data for all channels in this lap segment
  const columns = {};
  allChannels.forEach((ch) => {
    columns[ch] = indices.map((i) => data[ch]?.[i] ?? 0);
  });

  const lapCurrentLapTimes = varMap.has("LapCurrentLapTime")
    ? indices.map((i) => data["LapCurrentLapTime"][i])
    : [];

  // Compute statistics: mean, std, p05, p95 for each channel using TelemetryMath
  const stats = {};
  allChannels.forEach((ch) => {
    const channelStats = TelemetryMath.calculateStats(columns[ch]);
    stats[`${ch}_mean`] = channelStats.mean;
    stats[`${ch}_std`] = channelStats.std;
    stats[`${ch}_p05`] = channelStats.p05;
    stats[`${ch}_p95`] = channelStats.p95;
  });

  // Compute modulation (rate of change) for input channels using TelemetryMath
  const modStats = {};
  inputChannels.forEach((ch) => {
    const mod = TelemetryMath.calculateModulation(columns[ch]);
    modStats[`${ch}_mod_mean`] = mod.modMean;
    modStats[`${ch}_mod_std`] = mod.modStd;
  });

  // Compute normalized dynamics (relative to speed) using TelemetryMath
  const speed = columns["Speed"];
  const normDynamics = {
    long_accel_eff: TelemetryMath.calculateEfficiency(columns["LongAccel"], speed),
    lat_accel_eff: TelemetryMath.calculateEfficiency(columns["LatAccel"], speed),
    yaw_eff: TelemetryMath.calculateEfficiency(columns["YawRate"], speed),
  };

  // Compute control phase ratios
  const throttle = columns["Throttle"];
  const brake = columns["Brake"];
  const ratios = {};
  ratios["flatout_ratio"] = throttle.filter((t) => t > 0.95).length / nSamples;
  ratios["brake_ratio"] = brake.filter((b) => b > 0.2).length / nSamples;
  ratios["hard_brake_ratio"] = brake.filter((b) => b > 0.8).length / nSamples;
  ratios["partial_throttle_ratio"] =
    throttle.filter((t) => t > 0.05 && t < 0.95).length / nSamples;
  ratios["coast_ratio"] =
    throttle.filter((t, i) => t < 0.05 && brake[i] < 0.05).length / nSamples;

  // Compute scale-invariant ratios
  const ratioFeatures = {};
  const steerScrubs = [];
  const brakEffs = [];
  for (let i = 0; i < nSamples; i++) {
    steerScrubs.push(
      Math.abs(columns["SteeringWheelAngle"][i]) /
        Math.max(Math.abs(columns["LatAccel"][i]), 0.1),
    );
    brakEffs.push(
      columns["Brake"][i] / Math.max(Math.abs(columns["LongAccel"][i]), 0.1),
    );
  }
  ratioFeatures["steer_scrub_mean"] =
    steerScrubs.reduce((a, b) => a + b, 0) / nSamples;
  ratioFeatures["brake_eff_mean"] =
    brakEffs.reduce((a, b) => a + b, 0) / nSamples;

  // Compute correlations using TelemetryMath
  const correlations = {
    thr_longacc_corr: TelemetryMath.calculatePearsonCorrelation(throttle, columns["LongAccel"]),
    brk_longacc_corr: TelemetryMath.calculatePearsonCorrelation(brake, columns["LongAccel"]),
    steer_yaw_corr: TelemetryMath.calculatePearsonCorrelation(columns["SteeringWheelAngle"], columns["YawRate"]),
  };

  // Extract accurate lap duration if LapCurrentLapTime channel is available
  let lapTime = nSamples / telHdr.tickRate;
  if (lapCurrentLapTimes.length > 0) {
    lapTime = Math.max(...lapCurrentLapTimes);
  }

  // Combine all features
  const combined = Object.assign(
    {},
    stats,
    modStats,
    normDynamics,
    ratios,
    ratioFeatures,
    correlations,
  );
  return {
    features: combined,
    lapTime: lapTime,
  };
}

/**
 * Export computed lap features as CSV with metadata for all completed laps.
 * @returns {void}
 */
function exportFeatures() {
  setStatus("loading", "Grouping laps and computing features…");
  showProgress(10);

  try {
    const { varMap, telHdr, sampleCount, sessionInfo, file, data } = state;

    // Group sample indices by lap number
    const lapGroups = new Map();
    const lats = data["Lap"];
    for (let i = 0; i < sampleCount; i++) {
      let lapNum = lats ? lats[i] : 0;
      if (!lapGroups.has(lapNum)) {
        lapGroups.set(lapNum, []);
      }
      lapGroups.get(lapNum).push(i);
    }

    const track =
      getSessionField(sessionInfo, "TrackName") ||
      getSessionField(sessionInfo, "TrackDisplayName") ||
      "unknown";
    const car =
      getSessionField(sessionInfo, "CarScreenName") ||
      getSessionField(sessionInfo, "CarPath") ||
      "unknown";
    const setupname = getSessionField(sessionInfo, "DriverSetupName") || "";

    // Filter out extremely short/incomplete segments (e.g. less than 1 second of data)
    const minSamples = Math.min(30, telHdr.tickRate);
    const validLapNums = Array.from(lapGroups.keys())
      .filter((lapNum) => lapGroups.get(lapNum).length >= minSamples)
      .sort((a, b) => a - b);

    if (validLapNums.length === 0) {
      throw new Error("No valid laps found with sufficient samples.");
    }

    showProgress(30);

    const rows = [];
    let headerKeys = null;

    for (let idx = 0; idx < validLapNums.length; idx++) {
      const lapNum = validLapNums[idx];
      const indices = lapGroups.get(lapNum);
      const lapData = computeFeaturesForSampleIndices(indices);
      if (!lapData) continue;

      // Construct lap metadata
      const lapId = `${track}_${file.name.replace(/\.ibt$/i, "")}_L${lapNum}`;
      const metadata = {
        lap_id: lapId,
        lap_num: lapNum,
        car: car,
        track: track,
        setupname: setupname,
        laptime: lapData.lapTime,
        incident_points: 0, // Default fallback
      };

      const allKeys = Object.keys(metadata).concat(
        Object.keys(lapData.features).sort(),
      );
      if (!headerKeys) {
        headerKeys = allKeys;
      }

      // Format values for CSV (round floats to 6 decimals)
      const values = allKeys.map((key) => {
        const val = metadata[key] ?? lapData.features[key];
        if (typeof val === "number") {
          return val.toFixed(6).replace(/\.?0+$/, ""); // Remove trailing zeros
        }
        return `"${String(val).replace(/"/g, '""')}"`;
      });

      rows.push(values.join(","));
      showProgress(30 + Math.floor((idx / validLapNums.length) * 50));
    }

    if (rows.length === 0 || !headerKeys) {
      throw new Error("Could not extract features for any laps.");
    }

    const csv = headerKeys.join(",") + "\n" + rows.join("\n");

    showProgress(90);

    // Download CSV
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name.replace(/\.ibt$/i, "") + "_lap_features.csv";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showProgress(100);
    setStatus(
      "ok",
      `Exported features for ${validLapNums.length} lap(s) to CSV`,
    );
    setTimeout(hideProgress, 600);
  } catch (e) {
    setStatus("error", `Feature export failed: ${e.message}`);
  }
}

//  RENDERING FUNCTIONS

/**
 * Render the channel selection list in the sidebar.
 * @returns {void}
 */
function renderChannelList() {
  const list = document.getElementById("channelList");
  list.innerHTML = "";

  CHANNELS_DEFAULT.forEach((ch) => {
    const found = state.varMap.has(ch);
    const v = found ? state.varMap.get(ch) : null;
    const item = document.createElement("label");
    item.className = `channel-item${found ? "" : " not-found"}`;

    // Create checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = found && state.selectedChannels.has(ch);
    cb.disabled = !found;
    cb.addEventListener("change", () => {
      if (found) {
        cb.checked
          ? state.selectedChannels.add(ch)
          : state.selectedChannels.delete(ch);
      }
      renderPreview();
    });

    // Create label text
    const name = document.createElement("span");
    name.className = "ch-name";
    name.textContent = ch;

    item.appendChild(cb);
    item.appendChild(name);

    // Add unit or missing badge
    if (found) {
      const unit = document.createElement("span");
      unit.className = "ch-unit";
      unit.textContent = v.unit || "—";
      item.appendChild(unit);
    } else {
      const badge = document.createElement("span");
      badge.className = "ch-badge";
      badge.textContent = "missing";
      item.appendChild(badge);
    }

    list.appendChild(item);
  });
}

/**
 * Render the session metadata display.
 * @returns {void}
 */
function renderMeta() {
  const s = state.sessionInfo;
  const h = state.telHdr;
  const d = state.diskHdr;

  const fields = [
    ["Track", getSessionField(s, "TrackName") || getSessionField(s, "TrackDisplayName")],
    ["Car", getSessionField(s, "CarScreenName") || getSessionField(s, "CarPath")],
    ["Driver", getSessionField(s, "UserName")],
    ["Session type", getSessionField(s, "SessionType")],
    ["Setup name", getSessionField(s, "DriverSetupName")],
    ["Tick rate", `${h.tickRate} Hz`],
    ["Samples", state.sampleCount.toLocaleString()],
    ["Duration", `${(state.sampleCount / h.tickRate).toFixed(1)} s`],
    ["Laps logged", d.lapCount > 0 ? d.lapCount : "—"],
    ["bufOffset", `0x${h.bufOffset.toString(16)}`],
  ];

  const grid = document.getElementById("metaGrid");
  grid.innerHTML = "";

  fields.forEach(([label, val]) => {
    const card = document.createElement("div");
    card.className = "meta-card";
    const value = val || '<span style="color:var(--text-dim)">—</span>';
    card.innerHTML = `<div class="mc-label">${label}</div><div class="mc-value">${value}</div>`;
    grid.appendChild(card);
  });
}

/**
 * Render the data preview table.
 * @returns {void}
 */
function renderPreview() {
  const wrap = document.getElementById("previewTableWrap");
  const { telHdr, varMap, sampleCount, data } = state;
  const N = Math.min(25, sampleCount);

  const selChs = [...state.selectedChannels].filter((ch) => varMap.has(ch));

  // Build table
  let html = "<table><thead><tr>";
  html += '<th class="col-fixed">Time_s</th>';

  FIXED_CHANNELS.forEach((ch) => {
    const opacity = varMap.has(ch) ? "" : "opacity:0.3";
    html += `<th class="col-fixed" style="${opacity}">${ch}</th>`;
  });

  selChs.forEach((ch) => {
    html += `<th>${ch}</th>`;
  });

  html += "</tr></thead><tbody>";

  // Add data rows
  for (let i = 0; i < N; i++) {
    html += "<tr>";
    html += `<td class="col-fixed">${(i / telHdr.tickRate).toFixed(3)}</td>`;

    FIXED_CHANNELS.forEach((ch, fi) => {
      if (!varMap.has(ch)) {
        html += '<td class="col-fixed" style="opacity:0.3">—</td>';
        return;
      }
      const val = data[ch][i];
      const fmt =
        fi === 0 ? val : typeof val === "number" ? val.toFixed(4) : val;
      const cls = fi === 0 ? "col-lap" : "col-fixed";
      html += `<td class="${cls}">${fmt}</td>`;
    });

    selChs.forEach((ch) => {
      const val = data[ch][i];
      const fmt = typeof val === "number" ? val.toFixed(5) : val;
      html += `<td>${fmt}</td>`;
    });

    html += "</tr>";
  }

  html += "</tbody></table>";
  wrap.innerHTML = html;

  // Update info text
  document.getElementById("sampleCount").textContent =
    `${sampleCount.toLocaleString()} total samples`;
  document.getElementById("previewNote").textContent =
    `Showing first ${N} of ${sampleCount.toLocaleString()} samples · bufOffset=0x${telHdr.bufOffset.toString(16)} bufLen=${telHdr.bufLen}`;
}

//  CSV EXPORT

/**
 * Export loaded telemetry data as CSV.
 * Uses Web Worker to avoid blocking the UI during large exports.
 * @returns {void}
 */
function exportCSV() {
  const { varMap, telHdr, sampleCount, sessionInfo, file } = state;

  // Prepare variable lists - export ALL available channels
  const fixedVars = FIXED_CHANNELS.map((ch) => {
    const v = varMap.get(ch);
    return v ? { type: v.type, offset: v.offset, unit: v.unit || "" } : null;
  });

  // Always export all data channels
  const allDataChs = CHANNELS_DEFAULT.filter((ch) => varMap.has(ch));
  const selChs = allDataChs; // Export all available channels,
  const selVars = allDataChs.map((ch) => {
    const v = varMap.get(ch);
    return { type: v.type, offset: v.offset, unit: v.unit || "" };
  });

  // Prepare metadata header
  const metaLines = [
    "# IBT Extractor — iRacing Telemetry CSV",
    `# File: ${file.name}`,
    `# Track: ${getSessionField(sessionInfo, "TrackName") || getSessionField(sessionInfo, "TrackDisplayName") || ""}`,
    `# Car: ${getSessionField(sessionInfo, "CarScreenName") || getSessionField(sessionInfo, "CarPath") || ""}`,
    `# Session type: ${getSessionField(sessionInfo, "SessionType") || ""}`,
    `# Setup name: ${getSessionField(sessionInfo, "DriverSetupName") || ""}`,
    "",
  ].join("\n");

  // Start export
  setStatus("loading", "Building CSV…");
  showProgress(0);
  document.getElementById("exportBtn").disabled = true;

  // Create worker using module source
  const bufCopy = state.buffer.slice(0);
  const blob = new Blob([IBT_CSV_WORKER_SRC], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);

  // Send data to worker
  worker.postMessage(
    {
      buffer: bufCopy,
      bufOffset: telHdr.bufOffset,
      bufLen: telHdr.bufLen,
      tickRate: telHdr.tickRate,
      total: sampleCount,
      fixedVars,
      selVars,
      fixedNames: FIXED_CHANNELS,
      selNames: selChs,
      metaLines,
    },
    [bufCopy],
  );

  // Handle worker messages
  worker.onmessage = (e) => {
    if (e.data.type === "progress") {
      showProgress(parseFloat(e.data.pct));
    } else if (e.data.type === "done") {
      // Export complete, trigger download using module helper
      worker.terminate();
      URL.revokeObjectURL(workerUrl);

      const fileName = file.name.replace(/\.ibt$/i, "") + "_telemetry.csv";
      downloadFile(e.data.csv, fileName, "text/csv;charset=utf-8;");

      showProgress(100);
      document.getElementById("exportBtn").disabled = false;
      const colCount = selChs.length + FIXED_CHANNELS.length + 1;
      setStatus(
        "ok",
        `Exported ${sampleCount.toLocaleString()} samples · ${colCount} columns`,
      );
      setTimeout(hideProgress, 600);
    }
  };

  // Handle worker errors
  worker.onerror = (err) => {
    setStatus("error", `Export failed: ${err.message}`);
    document.getElementById("exportBtn").disabled = false;
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  };
}

//  EVENT LISTENERS

document.addEventListener("DOMContentLoaded", () => {
  // File input change
  document.getElementById("fileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) loadFile(f);
  });

  // Drag and drop zone
  const dz = document.getElementById("dropZone");

  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("drag-over");
  });

  dz.addEventListener("dragleave", () => {
    dz.classList.remove("drag-over");
  });

  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // Export button
  document.getElementById("exportBtn").addEventListener("click", exportCSV);

  // Export Features button
  document
    .getElementById("exportFeaturesBtn")
    .addEventListener("click", exportFeatures);

  // Clear button
  document.getElementById("clearBtn").addEventListener("click", () => {
    // Reset state
    Object.assign(state, {
      file: null,
      buffer: null,
      dv: null,
      telHdr: null,
      diskHdr: null,
      varMap: null,
      sessionInfo: "",
      sampleCount: 0,
      selectedChannels: new Set(CHANNELS_DEFAULT),
    });

    // Reset UI
    document.getElementById("channelList").innerHTML =
      '<div style="font-size:0.76rem;color:var(--text-dim);">Load a file to see channels.</div>';
    document.getElementById("metaSection").style.display = "none";
    document.getElementById("previewSection").style.display = "none";
    document.getElementById("emptyState").style.display = "flex";
    document.getElementById("exportBtn").disabled = true;
    document.getElementById("exportFeaturesBtn").disabled = true;
    document.getElementById("fileInput").value = "";

    setStatus("idle", "No file loaded");
  });
});