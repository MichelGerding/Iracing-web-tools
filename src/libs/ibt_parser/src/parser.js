"use strict";

/**
 * Variable types as defined in iRacing SDK (irsdk-constants.js)
 * Maps type IDs to size, parser functions, and typed array constructors
 */
const VAR_TYPE = {
  0: { size: 1, read: (dv, o) => dv.getUint8(o), array: Uint8Array }, // char
  1: { size: 1, read: (dv, o) => dv.getInt8(o) !== 0, array: Uint8Array }, // bool
  2: { size: 4, read: (dv, o) => dv.getInt32(o, true), array: Int32Array }, // int
  3: { size: 4, read: (dv, o) => dv.getUint32(o, true), array: Uint32Array }, // bitField
  4: { size: 4, read: (dv, o) => dv.getFloat32(o, true), array: Float32Array }, // float
  5: { size: 8, read: (dv, o) => dv.getFloat64(o, true), array: Float64Array }, // double
};

/**
 * @typedef {Object} VarHeader
 * @property {number} type - Variable type ID
 * @property {number} offset - Offset in the sample buffer
 * @property {number} count - Number of elements (for arrays)
 * @property {string} name - Variable name
 * @property {string} desc - Description
 * @property {string} unit - Unit of measurement
 */

/**
 * @typedef {Object} TelemetryHeader
 * @property {number} version - File format version
 * @property {number} status - Session status
 * @property {number} tickRate - Data logging frequency (Hz)
 * @property {number} sessionInfoUpdate - Session info update count
 * @property {number} sessionInfoLength - Length of YAML session info
 * @property {number} sessionInfoOffset - Offset to session info
 * @property {number} numVars - Number of telemetry variables
 * @property {number} varHeaderOffset - Offset to variable headers
 * @property {number} numBuf - Number of buffers
 * @property {number} bufLen - Length of each buffer
 * @property {number} bufOffset - Offset to the data buffer
 */

/**
 * @typedef {Object} DiskSubHeader
 * @property {number} startDate - Start date of the session
 * @property {number} startTime - Start time (seconds since start of day)
 * @property {number} endTime - End time
 * @property {number} lapCount - Total number of laps logged
 * @property {number} recordCount - Total number of records logged
 */

/**
 * @typedef {Object} IBTData
 * @property {TelemetryHeader} header
 * @property {DiskSubHeader} diskHeader
 * @property {Map<string, VarHeader>} varMap
 * @property {any} sessionInfo - Parsed YAML session info
 * @property {number} sampleCount
 * @property {Object.<string, TypedArray|Array>} data - Columnar telemetry data
 */

/**
 * Extract null-terminated ASCII string from byte array.
 * @param {Uint8Array} bytes - The byte array to decode
 * @returns {string}
 */
function nullTerm(bytes) {
  const end = bytes.indexOf(0);
  return new TextDecoder("ascii").decode(
    end < 0 ? bytes : bytes.subarray(0, end),
  );
}

/**
 * Parse the main telemetry header (112 bytes).
 * @param {DataView} dv - The data view of the IBT file
 * @returns {TelemetryHeader}
 */
function parseTelemetryHeader(dv) {
  const w = [];
  for (let i = 0; i < TELEMETRY_HEADER_SIZE / 4; i++) {
    w.push(dv.getInt32(i * 4, true));
  }

  return {
    version: w[0],
    status: w[1],
    tickRate: w[2],
    sessionInfoUpdate: w[3],
    sessionInfoLength: w[4],
    sessionInfoOffset: w[5],
    numVars: w[6],
    varHeaderOffset: w[7],
    numBuf: w[8],
    bufLen: w[9],
    bufOffset: w[13], // Actual data start offset
  };
}

/**
 * Parse the disk sub-header (32 bytes, starts at offset 112).
 * @param {DataView} dv - The data view of the IBT file
 * @returns {DiskSubHeader}
 */
function parseDiskSubHeader(dv) {
  const base = TELEMETRY_HEADER_SIZE;
  return {
    startDate: dv.getFloat32(base, true),
    startTime: dv.getFloat64(base + 8, true),
    endTime: dv.getFloat64(base + 16, true),
    lapCount: dv.getInt32(base + 24, true),
    recordCount: dv.getInt32(base + 28, true),
  };
}

/**
 * Parse all variable headers from the file.
 * @param {DataView} dv - The data view of the IBT file
 * @param {number} offset - Offset to variable headers
 * @param {number} numVars - Number of variables to parse
 * @returns {Map<string, VarHeader>}
 */
function parseVarHeaders(dv, offset, numVars) {
  const vars = new Map();

  for (let i = 0; i < numVars; i++) {
    const b = offset + i * VAR_HEADER_SIZE;
    const name = nullTerm(new Uint8Array(dv.buffer, b + 16, 32));

    vars.set(name, {
      type: dv.getInt32(b, true),
      offset: dv.getInt32(b + 4, true),
      count: dv.getInt32(b + 8, true),
      name,
      desc: nullTerm(new Uint8Array(dv.buffer, b + 48, 64)),
      unit: nullTerm(new Uint8Array(dv.buffer, b + 112, 32)),
    });
  }

  return vars;
}

/**
 * Read a single variable value from a sample buffer.
 * @param {DataView} dv - The data view of the IBT file
 * @param {number} sampleBase - Base offset of the sample in the buffer
 * @param {VarHeader} varHdr - Header for the variable to read
 * @returns {number|boolean|null}
 */
function readVar(dv, sampleBase, varHdr) {
  const vt = VAR_TYPE[varHdr.type];
  if (!vt) return null;
  return vt.read(dv, sampleBase + varHdr.offset);
}

/**
 * Complete parsing of an IBT file into a structured object.
 * Extracts all metadata and telemetry data.
 *
 * @param {ArrayBuffer} buffer - The raw binary data of the IBT file
 * @returns {IBTData} Parsed telemetry data including headers, variables, and samples
 */
function parseIBT(buffer) {
  const dv = new DataView(buffer);

  const header = parseTelemetryHeader(dv);
  if (header.version < 1) {
    throw new Error("Invalid IBT file version");
  }

  const diskHeader = parseDiskSubHeader(dv);
  const varMap = parseVarHeaders(dv, header.varHeaderOffset, header.numVars);

  const siBytes = new Uint8Array(
    buffer,
    header.sessionInfoOffset,
    header.sessionInfoLength,
  );
  const yamlStr = new TextDecoder("ascii")
    .decode(siBytes)
    .replace(/\0/g, "");

  const sessionInfo = YAML.parse(yamlStr);

  const sampleCount =
    diskHeader.recordCount > 0
      ? diskHeader.recordCount
      : Math.floor((buffer.byteLength - header.bufOffset) / header.bufLen);

  const data = {};
  const varList = Array.from(varMap.values());

  // Initialize typed arrays for each variable
  varList.forEach((v) => {
    const typeInfo = VAR_TYPE[v.type];
    if (typeInfo && typeInfo.array) {
      data[v.name] = new typeInfo.array(sampleCount);
    } else {
      data[v.name] = new Array(sampleCount);
    }
  });

  // Extract all samples (transposing from interleaved rows to columns)
  for (let i = 0; i < sampleCount; i++) {
    const sampleBase = header.bufOffset + i * header.bufLen;
    for (let j = 0; j < varList.length; j++) {
      const v = varList[j];
      const typeInfo = VAR_TYPE[v.type];
      data[v.name][i] = typeInfo.read(dv, sampleBase + v.offset);
    }
  }

  return {
    header,
    diskHeader,
    varMap,
    sessionInfo,
    sampleCount,
    data,
  };
}


/**
 * Helper to find common fields in the parsed iRacing session info object.
 * iRacing YAML is deeply nested; this searches common locations.
 *
 * @param {Object} sessionInfo - Parsed YAML object
 * @param {string} key - Field name to search for
 * @returns {any} Field value or empty string
 */
function getSessionField(sessionInfo, key) {
  if (!sessionInfo) return "";

  // 1. Check top-level (unlikely for most fields)
  if (sessionInfo[key] !== undefined) return sessionInfo[key];

  // 2. Check WeekendInfo
  if (sessionInfo.WeekendInfo && sessionInfo.WeekendInfo[key] !== undefined) {
    return sessionInfo.WeekendInfo[key];
  }

  // 3. Check DriverInfo
  if (sessionInfo.DriverInfo) {
    if (sessionInfo.DriverInfo[key] !== undefined) {
      return sessionInfo.DriverInfo[key];
    }
    // Deep check for car names which are usually in the Drivers array
    if (key === "CarScreenName" || key === "CarPath") {
      const idx = sessionInfo.DriverInfo.DriverCarIdx;
      const drivers = sessionInfo.DriverInfo.Drivers;
      if (drivers && drivers[idx]) {
        return drivers[idx][key] || "";
      }
    }
  }

  // 4. Recursive search as fallback (expensive but reliable for "flattened" feel)
  function findRecursive(obj, target) {
    if (obj && typeof obj === "object") {
      if (obj[target] !== undefined) return obj[target];
      for (const k in obj) {
        const res = findRecursive(obj[k], target);
        if (res !== undefined) return res;
      }
    }
    return undefined;
  }

  return findRecursive(sessionInfo, key) || "";
}
