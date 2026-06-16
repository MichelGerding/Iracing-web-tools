'use strict';

/**
 * Web Worker source code for CSV generation.
 * Runs export in background to avoid blocking the UI.
 * This can be used as a Blob URL for a Web Worker.
 * @type {string}
 */
const IBT_CSV_WORKER_SRC = `
'use strict';
const VAR_TYPE_READ = [
  (dv,o) => dv.getUint8(o),
  (dv,o) => dv.getInt8(o) !== 0,
  (dv,o) => dv.getInt32(o,true),
  (dv,o) => dv.getUint32(o,true),
  (dv,o) => dv.getFloat32(o,true),
  (dv,o) => dv.getFloat64(o,true),
];
self.onmessage = function(e) {
  const { buffer, bufOffset, bufLen, tickRate, total,
          fixedVars, selVars, fixedNames, selNames, metaLines } = e.data;
  const dv = new DataView(buffer);
  const allVars = [...fixedVars, ...selVars];
  const allNames = [...fixedNames, ...selNames];
  const allUnits = [
    's',
    ...fixedVars.map(v => v ? (v.unit||'') : ''),
    ...selVars.map(v => v.unit||'')
  ];
  const headerRow = ['Time_s', ...allNames].join(',');
  const unitsRow  = allUnits.join(',');
  let out = metaLines + headerRow + '\\n' + unitsRow + '\\n';
  const CHUNK = 10000;
  let i = 0;
  function step() {
    const end = Math.min(i + CHUNK, total);
    const rows = [];
    for (; i < end; i++) {
      const base = bufOffset + i * bufLen;
      let row = (i / tickRate).toFixed(4);
      allVars.forEach(v => {
        if (!v) { row += ','; return; }
        const fn = VAR_TYPE_READ[v.type];
        row += ',' + (fn ? fn(dv, base + v.offset) : '');
      });
      rows.push(row);
    }
    out += rows.join('\\n') + '\\n';
    self.postMessage({ type: 'progress', pct: (i / total * 100).toFixed(1) });
    if (i < total) { setTimeout(step, 0); }
    else { self.postMessage({ type: 'done', csv: out }); }
  }
  step();
};
`;

/**
 * Triggers a file download in the browser.
 * @param {string|Blob} content - The file content
 * @param {string} fileName - The name of the file
 * @param {string} mimeType - The MIME type
 * @returns {void}
 */
function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
