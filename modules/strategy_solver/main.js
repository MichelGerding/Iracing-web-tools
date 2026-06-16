function getInputs() {
    return {
        stops:       parseInt(document.getElementById('pitstop-count').value) || 1,
        lapsPerTank: parseInt(document.getElementById('laps-per-tank').value) || 30,
        basePitCost: parseFloat(document.getElementById('base-pit-cost').value) || 25,
        timeLoss:    parseFloat(document.getElementById('tire-time-loss').value) || 3,
        raceMins:    parseFloat(document.getElementById('race-duration').value) || 60,
        meanLap:     parseFloat(document.getElementById('mean-lap-time').value) || 90,
        degPerLap:   parseFloat(document.getElementById('per-lap-deg').value) || 0,
    };
}

function totalLaps(raceMins, meanLap) {
    return Math.ceil((raceMins * 60) / meanLap);
}

function lapTime(tireAge, meanLap, degPerLap) {
    return meanLap + (tireAge * degPerLap);
}

/**
 * Pure simulation
 */
function simulateRace(stopDefs, totalLaps, meanLap, degPerLap, basePitCost, timeLoss) {
    let time = 0;
    let tireAge = 0;
    let stopIdx = 0;

    for (let lap = 1; lap <= totalLaps; lap++) {
        time += lapTime(tireAge, meanLap, degPerLap);
        tireAge++;

        if (stopIdx < stopDefs.length && lap === stopDefs[stopIdx].lap) {
            time += basePitCost;

            if (stopDefs[stopIdx].changeTires) {
                time += timeLoss;
                tireAge = 0;
            }
            stopIdx++;
        }
    }
    return time;
}

/**
 * Validity check: Only fuel constraints force a pit stop
 */
function isValidRace(stopDefs, lapsPerTank, lapCount) {
    let fuelAge = 0;
    let stopIdx = 0;

    for (let lap = 1; lap <= lapCount; lap++) {
        fuelAge++;

        if (fuelAge > lapsPerTank) return false;

        if (stopIdx < stopDefs.length && lap === stopDefs[stopIdx].lap) {
            fuelAge = 0;
            stopIdx++;
        }
    }
    return true;
}

function generatePitStops(nStops, lapCount) {
    const res = [];
    function rec(i, start, arr) {
        if (i === nStops) {
            res.push([...arr]);
            return;
        }
        for (let lap = start; lap <= lapCount - (nStops - i - 1); lap++) {
            arr.push(lap);
            rec(i + 1, lap + 1, arr);
            arr.pop();
        }
    }
    rec(0, 1, []);
    return res;
}

function generateTireConfigs(n) {
    const out = [];
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
        const arr = [];
        for (let i = 0; i < n; i++) {
            arr.push(Boolean(mask & (1 << i)));
        }
        out.push(arr);
    }
    return out;
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
}

function formatDelta(t, best) {
    const d = t - best;
    return d === 0 ? '★' : `+${d.toFixed(3)}s`;
}

/**
 * MAIN
 */
function runSimulation() {
    const {
        stops,
        lapsPerTank,
        basePitCost,
        timeLoss,
        raceMins,
        meanLap,
        degPerLap
    } = getInputs();

    const lapCount = totalLaps(raceMins, meanLap);
    const pitLayouts = generatePitStops(stops, lapCount);
    const results = [];

    for (const laps of pitLayouts) {
        const configs = generateTireConfigs(laps.length);
        for (const cfg of configs) {
            const stopDefs = laps.map((lap, i) => ({
                lap,
                changeTires: cfg[i]
            }));

            if (!isValidRace(stopDefs, lapsPerTank, lapCount)) continue;

            const time = simulateRace(stopDefs, lapCount, meanLap, degPerLap, basePitCost, timeLoss);
            const isNoTireChange = cfg.every(x => x === false);

            results.push({ stopDefs, time, noTireChange: isNoTireChange });
        }
    }

    if (!results.length) {
        alert(`No valid strategies found. Fuel tank (${lapsPerTank} laps) cannot complete the ${lapCount} lap race with ${stops} stop(s).`);
        return;
    }

    // Sort results by time, with smart tie-breakers
    results.sort((a, b) => {
        const tDiff = a.time - b.time;
        if (Math.abs(tDiff) > 1e-6) return tDiff; // Order by time primarily

        // Tie-breakers for identical times:
        // 1. Prefer fewer pit stops overall
        if (a.stopDefs.length !== b.stopDefs.length) return a.stopDefs.length - b.stopDefs.length;
        // 2. Prefer No Tire Changes
        if (a.noTireChange && !b.noTireChange) return -1;
        if (!a.noTireChange && b.noTireChange) return 1;
        // 3. Prefer earlier initial pit stop
        const aFirst = a.stopDefs[0]?.lap || 0;
        const bFirst = b.stopDefs[0]?.lap || 0;
        return aFirst - bFirst;
    });

    // GROUP identical times together
    const grouped = [];
    for (const r of results) {
        const timeStr = r.time.toFixed(3);
        if (!grouped.length || grouped[grouped.length - 1].timeStr !== timeStr) {
            grouped.push({ timeStr, time: r.time, primary: r, others: [] });
        } else {
            grouped[grouped.length - 1].others.push(r);
        }
    }

    const best = grouped[0].time;

    renderPlot(grouped, best);
    renderTable(grouped, best);
}

/**
 * PLOT
 */
function renderPlot(grouped, best) {
    const content = document.querySelector('.content');

    let plotDiv = document.getElementById('sim-plot');
    if (!plotDiv) {
        plotDiv = document.createElement('div');
        plotDiv.id = 'sim-plot';
        plotDiv.style.width = '100%';
        plotDiv.style.height = '420px';
        content.prepend(plotDiv);
    }

    const x = grouped.map((_, i) => i + 1);
    const y = grouped.map(g => +(g.time - best).toFixed(3));

    const labels = grouped.map(g => {
        const desc = g.primary.stopDefs.map(s =>
            `L${s.lap}${s.changeTires ? ' 🔄' : ' ⛽'}`
        ).join('  ');

        let text = `${desc}<br>Total: ${formatTime(g.time)}<br>Δ: ${formatDelta(g.time, best)}`;
        if (g.primary.noTireChange) text += `<br><b>(No Tire Changes)</b>`;
        if (g.others.length > 0) text += `<br><i>+ ${g.others.length} equivalent strategies</i>`;

        return text;
    });

    Plotly.react(plotDiv, [{
        type: 'bar',
        x,
        y,
        text: grouped.map(g => g.time === best ? '★' : ''),
        textposition: 'outside',
        hovertext: labels,
        hoverinfo: 'text',
        marker: {
            color: grouped.map(g => {
                if (g.time === best) return '#e8ff47';
                if (g.primary.noTireChange) return '#ff7a47';
                return '#4fff91';
            }),
            opacity: 0.8,
        },
    }], {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#f0f0f0', family: 'JetBrains Mono, monospace', size: 11 },
        margin: { t: 20, r: 20, b: 40, l: 60 },
        xaxis: { title: 'Strategy rank (Unique outcomes)' },
        yaxis: { title: 'Δ best (s)' }
    }, { responsive: true, displayModeBar: false });
}

/**
 * TABLE
 */
function renderTable(grouped, best) {
    const content = document.querySelector('.content');

    let wrap = document.getElementById('sim-table-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'sim-table-wrap';
        wrap.className = 'preview-table-wrap';
        content.appendChild(wrap);
    }

    // Determine all laps where a pit stop occurs across *any* strategy in any group
    const cols = new Set();
    grouped.forEach(g => {
        g.primary.stopDefs.forEach(s => cols.add(s.lap));
        g.others.forEach(o => o.stopDefs.forEach(s => cols.add(s.lap)));
    });
    const lapCols = [...cols].sort((a, b) => a - b);
    const header = lapCols.map(l => `<th>L${l}</th>`).join('');

    const rows = grouped.map((g, i) => {
        const pMap = new Map(g.primary.stopDefs.map(s => [s.lap, s.changeTires]));
        const pCells = lapCols.map(l => {
            if (!pMap.has(l)) return `<td>—</td>`;
            return `<td>${pMap.get(l) ? '🔄' : '⛽'}</td>`;
        }).join('');

        const toggleButton = g.others.length
            ? `<br><span class="toggle-btn" data-group="${i}" style="cursor: pointer; color: #1e1e2e; background: #4fff91; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-top: 6px; font-weight: bold; font-size: 0.8em;">[+] ${g.others.length} equivalent</span>`
            : '';

        let html = `<tr style="${g.primary.noTireChange ? 'background: rgba(255, 122, 71, 0.1);' : ''}">
            <td>${i + 1}</td>
            ${pCells}
            <td>${formatTime(g.time)} ${toggleButton}</td>
            <td>${formatDelta(g.time, best)}</td>
        </tr>`;

        // Render hidden variations
        g.others.forEach((other) => {
            const oMap = new Map(other.stopDefs.map(s => [s.lap, s.changeTires]));
            const oCells = lapCols.map(l => {
                if (!oMap.has(l)) return `<td>—</td>`;
                return `<td>${oMap.get(l) ? '🔄' : '⛽'}</td>`;
            }).join('');

            html += `<tr class="sub-row group-${i}" style="display: none; font-size: 0.9em; opacity: 0.7; ${other.noTireChange ? 'background: rgba(255, 122, 71, 0.05);' : 'background: rgba(255, 255, 255, 0.02);'}">
                <td style="text-align: right; border-right: 2px solid #555;">↳</td>
                ${oCells}
                <td>${formatTime(other.time)}</td>
                <td>${formatDelta(other.time, best)}</td>
            </tr>`;
        });

        return html;
    }).join('');

    wrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    ${header}
                    <th>Total Time</th>
                    <th>Δ Best</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="font-size: 0.85em; margin-top: 10px; color: #aaa;">
            Legend: 🔄 = Tires & Fuel | ⛽ = Fuel Only
        </div>
    `;

    // Attach Event Listeners to expand/collapse buttons
    wrap.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const groupId = btn.dataset.group;
            const rows = wrap.querySelectorAll(`.sub-row.group-${groupId}`);
            const isOpen = btn.textContent.includes('[-]');

            rows.forEach(r => r.style.display = isOpen ? 'none' : 'table-row');

            const count = rows.length;
            btn.textContent = isOpen ? `[+] ${count} equivalent` : `[-] Hide equivalent`;
            btn.style.background = isOpen ? '#4fff91' : '#ff7a47';
        });
    });
}

document.querySelectorAll('#simulate').forEach(el => {
    el.addEventListener('click', runSimulation);
});