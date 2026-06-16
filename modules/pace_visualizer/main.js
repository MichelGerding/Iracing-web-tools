/* ── Palette ─────────────────────────────────────────────── */
const FILE_COLORS = [
    { point: "#e8ff47", line: "#b8cc30", fill: "rgba(232,255,71,0.06)" },
    { point: "#4fb8ff", line: "#2a9de0", fill: "rgba(79,184,255,0.06)" },
    { point: "#ff7f4f", line: "#cc5a28", fill: "rgba(255,127,79,0.06)" },
    { point: "#4fff91", line: "#28cc64", fill: "rgba(79,255,145,0.06)" },
    { point: "#d97bff", line: "#a845e0", fill: "rgba(217,123,255,0.06)" },
    { point: "#ffaa4f", line: "#cc7e28", fill: "rgba(255,170,79,0.06)" },
];

/* ── Plotly base ─────────────────────────────────────────── */
const PL = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { family: "'JetBrains Mono', monospace", color: "#888", size: 11 },
    margin: { t: 8, r: 20, b: 48, l: 56 },
    xaxis: { gridcolor: "#2e2e34", zerolinecolor: "#2e2e34", tickfont: { color: "#555" }, title: { text: "Lap in stint", font: { color: "#555", size: 11 } } },
    yaxis: { gridcolor: "#2e2e34", zerolinecolor: "#2e2e34", tickfont: { color: "#555" } },
    legend: { bgcolor: "rgba(0,0,0,0)", font: { color: "#888", size: 11 }, orientation: "h", x: 0, y: 1.08 },
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#18181b", bordercolor: "#2e2e34", font: { color: "#f0f0f0", size: 12 } }
};
const PC = { displayModeBar: false, responsive: true };

let files = [];
let combineFiles = false;
let zeroLaps = true;
let filterMode = "fully"; // fully | clean | no-pits | all

/* ── Helpers ─────────────────────────────────────────────── */
function parseCSV(text) {
    return Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
}

function fmt(s) {
    if (s == null || isNaN(s)) return "—";
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(3).padStart(6, "0");
    return m > 0 ? `${m}:${sec}` : `${(+s).toFixed(3)}s`;
}

function shortName(name) {
    const extension_stripped = name.replace(/\.csv$/i, "");
    const parts = extension_stripped.split(" - ");
    return parts.filter(part => !["Garage 61", "Export"].includes(part)).join(" - ");
}

function filterLaps(file) {
    let laps = file.rows.filter(row => {
        if (!file.selectedRuns.has(row["Run"])) return false;
        switch (filterMode) {
            case "fully":
            case "clean":
                if (row["Clean"] === 0) return false; // FALLTHROUGH
            case "no-pits":
                if (row["Pit in"] === 1 || row["Pit out"] === 1) return false;
        }
        return true;
    });

    if (laps.length === 0) return;

    // remove laps outside of rolling 3 x IQR
    if (filterMode === "fully") {
        window.laps = laps;
        const laptimes = laps.map(l => l["Lap time"]);
        const bounds = rollingIQRBounds(laptimes, 7, 3);

        laps = laps.filter((lap, i) => {
            const t = laptimes[i];
            const { lower, upper } = bounds[i];

            return t >= lower && t <= upper;
        });
    }

    return laps;
}

function regressLapTimes(file, zeroLaps) {
    const laps = filterLaps(file);
    if (!laps || !laps.length) return;

    const firstLapNum = zeroLaps ? Math.min(...laps.map(l => l["Lap"])) : 0;

    const x = laps.map(l => l["Lap"] - firstLapNum);
    const y = laps.map(l => l["Lap time"]);

    return [polyfit2(x, y), x, y];
}

/* ── Render plots ────────────────────────────────────────── */
function render() {
    const degTraces = [], drvTraces = [], cumTraces = [];
    let globalMaxX = 100; // for the derivative zero-line

    let combinedX = [];
    let combinedY = [];

    // Helper to generate the regression trendlines and fill areas
    function addTrendTraces(coeffs, x, col, label) {
        const minX = Math.min(...x);
        const maxX = Math.max(...x);
        if (maxX > globalMaxX) globalMaxX = maxX;

        const { xs, ys } = smoothCurve(coeffs, minX, maxX);
        const [a, b, c] = coeffs;

        const xLaps = Array.from({ length: maxX - minX + 1 }, (_, i) => minX + i);

        // -- 1. Degradation trend line
        degTraces.push({
            x: xs, y: ys,
            mode: "lines", type: "scatter",
            name: label + " fit", legendgroup: label,
            showlegend: false,
            line: { color: col.line, width: 2, dash: "dot" }
        });

        // -- 2. Derivative plot (Rate of Change)
        const dydxSmooth = xs.map(xi => b + 2 * c * xi);
        const dydxLaps = xLaps.map(xi => b + 2 * c * xi);

        drvTraces.push({
            x: xs, y: dydxSmooth,
            mode: "lines", type: "scatter",
            name: label + " trend", legendgroup: label,
            showlegend: false,
            line: { color: col.line, width: 2 },
            fill: "tozeroy", fillcolor: col.fill
        });

        drvTraces.push({
            x: xLaps, y: dydxLaps,
            mode: "markers", type: "scatter",
            name: label, legendgroup: label,
            marker: {
                color: dydxLaps.map(v => v > 0 ? "#ff4f4f" : col.point),
                size: 7,
                line: { color: "rgba(0,0,0,0.2)", width: 1 }
            }
        });

        // -- 3. Cumulative plot (Drift)
        const baseline = pred(coeffs, minX);
        const cumLaps = xLaps.map(xi => pred(coeffs, xi) - baseline);

        cumTraces.push({
            x: xs, y: ys.map(v => v - baseline),
            mode: "lines", type: "scatter",
            name: label + " trend", legendgroup: label,
            showlegend: false,
            line: { color: col.line, width: 2 },
            fill: "tozeroy", fillcolor: col.fill
        });

        cumTraces.push({
            x: xLaps, y: cumLaps,
            mode: "markers", type: "scatter",
            name: label, legendgroup: label,
            marker: { color: col.point, size: 6, opacity: 0.7 }
        });
    }

    files.forEach(file => {
        const col = FILE_COLORS[file.colorIdx % FILE_COLORS.length];
        if (file.rows.length === 0) return;

        const res = regressLapTimes(file, zeroLaps);
        if (!res) return;
        const [coeffs, x, y] = res;

        const label = shortName(file.name);

        // Always plot individual scatter points per file
        degTraces.push({
            x, y,
            mode: "markers",
            type: "scatter",
            name: label,
            legendgroup: combineFiles ? "Combined" : label, // Snap legend groups together if combined
            marker: { color: col.point, size: 6, opacity: 0.85 }
        });

        if (combineFiles) {
            // Aggregate all filtered points
            combinedX.push(...x);
            combinedY.push(...y);
        } else {
            // Draw trendline just for this specific file
            addTrendTraces(coeffs, x, col, label);
        }
    });

    if (combineFiles && combinedX.length > 0) {
        // Compute one single master regression over the aggregated points
        const combinedCoeffs = polyfit2(combinedX, combinedY);
        const combinedCol = { line: "#ffffff", fill: "rgba(255, 255, 255, 0.1)", point: "#ffffff" };

        addTrendTraces(combinedCoeffs, combinedX, combinedCol, "Combined Fit");
    }

    drvTraces.push({
        x: [0, globalMaxX + 5], // Ensure the zero-line stretches far enough
        y: [0, 0],
        mode: "lines",
        type: "scatter",
        showlegend: false,
        line: { color: "#444", width: 1, dash: "dash" }
    });

    Plotly.react("plot-degradation", degTraces, { ...PL }, PC);
    Plotly.react("plot-derivative", drvTraces, { ...PL }, PC);
    Plotly.react("plot-cumulative", cumTraces, { ...PL }, PC);

    renderStats();
}

/* ── Stats strip ─────────────────────────────────────────── */
function renderStats() {
    const strip = document.getElementById("stats-strip");
    strip.innerHTML = "";

    // Helper to generate a single stat card
    function addStatCard(label, col, x, y, coeffs) {
        const [a, b, c] = coeffs;
        const best = Math.min(...y);

        // Compute precise domains to evaluate polynomials properly
        // (prevents length accumulation bugs when multiple stints overlap)
        const minX = Math.min(...x);
        const maxX = Math.max(...x);
        const midX = minX + (maxX - minX) / 2;

        const degMid = b + 2 * c * midX;
        const totalDrop = pred(coeffs, maxX) - pred(coeffs, minX);

        const card = document.createElement("div");
        card.className = "stat-card";
        card.innerHTML = `
            <div class="sc-file-label" style="color:${col.line};">${label}</div>
            <div class="sc-row">
                <span class="sc-mini-label">Laps</span>
                <span class="sc-mini-value">${x.length}</span>
            </div>
            <div class="sc-row">
                <span class="sc-mini-label">Best</span>
                <span class="sc-mini-value" style="color:var(--green)">${fmt(best)}</span>
            </div>
            <div class="sc-row">
                <span class="sc-mini-label">Deg/lap</span>
                <span class="sc-mini-value" style="color:${degMid > 0 ? "var(--red)" : "var(--green)"}">${(degMid >= 0 ? "+" : "") + degMid.toFixed(3)}s</span>
            </div>
            <div class="sc-row">
                <span class="sc-mini-label">Total drop</span>
                <span class="sc-mini-value" style="color:${totalDrop > 0 ? "var(--red)" : "var(--green)"}">${(totalDrop >= 0 ? "+" : "") + totalDrop.toFixed(3)}s</span>
            </div>`;
        strip.appendChild(card);
    }

    if (combineFiles) {
        let combinedX = [];
        let combinedY = [];

        files.forEach(file => {
            const res = regressLapTimes(file, zeroLaps);
            if (res) {
                combinedX.push(...res[1]);
                combinedY.push(...res[2]);
            }
        });

        if (combinedX.length > 0) {
            const combinedCoeffs = polyfit2(combinedX, combinedY);
            const combinedCol = { line: "#ffffff", fill: "rgba(255, 255, 255, 0.1)", point: "#ffffff" };
            addStatCard("Combined Files", combinedCol, combinedX, combinedY, combinedCoeffs);
        }
    } else {
        files.forEach(file => {
            const col = FILE_COLORS[file.colorIdx % FILE_COLORS.length];
            const res = regressLapTimes(file);
            if (!res) return;

            const [coeffs, x, y] = res;
            addStatCard(shortName(file.name), col, x, y, coeffs);
        });
    }
}

/* ── Sidebar file list ───────────────────────────────────── */
function renderFileList() {
    const list = document.getElementById("file-list");
    list.innerHTML = "";

    files.forEach((file, fi) => {
        const col = FILE_COLORS[file.colorIdx % FILE_COLORS.length];
        const section = document.createElement("div");
        section.className = "file-section";

        const header = document.createElement("div");
        header.className = "file-section-header";
        header.innerHTML = `
            <span class="file-dot" style="background:${col.point};"></span>
            <span class="file-name">${shortName(file.name)}</span>
            <button class="file-remove" data-fi="${fi}" title="Remove file">×</button>`;
        section.appendChild(header);

        // Create the labels for each stint. this way you
        const label = document.createElement("div");
        label.className = "section-label" ;
        label.style.marginTop = "8px";
        label.textContent = "Runs";
        section.appendChild(label);

        const chips = document.createElement("div");
        chips.className = "run-selector";
        [...file.runs].sort((a,b)=>a-b).forEach(run => {
            const chip = document.createElement("button");
            chip.className = "run-chip" + (file.selectedRuns.has(run) ? " selected" : "");
            chip.style.setProperty("--chip-active-color", col.point);
            chip.style.setProperty("--chip-active-border", col.line);
            chip.textContent = `R${run}`;
            chip.addEventListener("click", () => {
                if (file.selectedRuns.has(run)) {
                    // if (file.selectedRuns.size > 1)
                    file.selectedRuns.delete(run);
                } else {
                    file.selectedRuns.add(run);
                }
                renderFileList();
                render();
            });
            chips.appendChild(chip);
        });
        section.appendChild(chips);

        list.appendChild(section);
    });

    // Remove file listeners
    list.querySelectorAll(".file-remove").forEach(btn => {
        btn.addEventListener("click", () => {
            files.splice(+btn.dataset.fi, 1);
            if (!files.length) {
                document.getElementById("empty-state").style.display = "flex";
                document.getElementById("analysis-section").style.display = "none";
            }
            renderFileList();
            render();
        });
    });
}

/* ── Filter switch ───────────────────────────────────────── */
document.querySelectorAll(".filter-switch-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-switch-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        filterMode = btn.dataset.mode;
        render();
    });
});

document.querySelectorAll(".combine-files-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        combineFiles = btn.classList.contains("active");
        render();
    })
})

document.querySelectorAll(".zero-laps-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        zeroLaps = btn.classList.contains("active");
        render();
    })
})

/* ── Tabs ────────────────────────────────────────────────── */
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
        setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    });
});

/* ── File drop ───────────────────────────────────────────── */
document.querySelector("drop-zone")
    .addEventListener("file-selected", async (e) => {
        const incoming = Array.from(e.detail.files);
        for (const file of incoming) {
            // // Skip duplicates by name
            // if (files.find(f => f.name === file.name)) continue;

            const text = await file.text();
            const rows = parseCSV(text);
            const runSet = new Set(rows.map(r => r["Run"]).filter(r => r != null));
            const runs = [...runSet].sort((a, b) => a - b);
            // Default: skip first out-lap run and last in-lap run if multiple runs exist
            const defaultRuns = runs.length > 2 ? runs.slice(1, runs.length - 1) : runs;

            files.push({
                name: file.name,
                rows,
                runs: runSet,
                selectedRuns: new Set(defaultRuns),
                colorIdx: files.length
            });
        }

        if (files.length) {
            document.getElementById("empty-state").style.display = "none";
            document.getElementById("analysis-section").style.display = "block";
        }

        renderFileList();
        render();
    });