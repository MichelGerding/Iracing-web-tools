
function kIQR(window, k) {
    const q1 = math.quantileSeq(window, 0.25);
    const q3 = math.quantileSeq(window, 0.75);
    const iqr = q3 - q1;

    return {
        lower: q1 - k * iqr,
        upper: q3 + k * iqr,
    };
}

function rollingIQRBounds(values, windowSize, k = 1.5) {
    const n = values.length;

    // If window is too large, fall back to full-series IQR
    if (n <= windowSize) {
        const singleBound = kIQR(values, k);
        return Array(n).fill(singleBound);
    }

    const bounds = [];
    const half = Math.floor(windowSize / 2);

    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - half);
        const end = Math.min(n, start + half + (windowSize % 2 === 0 ? half : half + 1));

        const window = values.slice(start, end);

        bounds.push(kIQR(window, k));
    }

    return bounds;
}


function polyfit2(x, y) {
    const X = x.map(v => [1, v, v * v]);
    const XT = math.transpose(X);
    const beta = math.lusolve(math.multiply(XT, X), math.multiply(XT, y));
    return beta.map(v => v[0]);
}

function pred([a, b, c], x) {
    return a + b * x + c * x * x;
}

function smoothCurve(coeffs, minX, maxX, step = 0.1) {
    const xs = [];
    const ys = [];

    for (let x = minX; x <= maxX; x += step) {
        xs.push(x);
        ys.push(pred(coeffs, x));
    }

    return { xs, ys };
}
