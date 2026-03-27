// Deep trace: instrument the _fillGapsFromMix to see exactly what it does
const fs = require('fs');

const code = fs.readFileSync('js/beatmap.js', 'utf8')
    .replace('window.BeatMapManager = BeatMapManager;', 'module.exports = BeatMapManager;');
const BeatMapManager = eval(code + '\nBeatMapManager;');

const data = JSON.parse(fs.readFileSync("songs/downs-east/Deckhands' Delight.json", 'utf8'));
const manager = new BeatMapManager();

// Step 1: Generate vocal notes WITHOUT gap-fill
const diffConfig = { id: 'hard', noteFrequency: 1.0, lanes: 5, timingWindow: 0.75 };
const skipLeadIn = 1.5;
const skipEnd = 1.0;
const duration = data.duration;

// Reconstruct what _generateVocalNotes produces
let seed = 0;
for (let i = 0; i < "Deckhands' Delight".length; i++) {
    seed = ((seed << 5) - seed) + "Deckhands' Delight".charCodeAt(i);
    seed |= 0;
}
seed = (seed * 31 + Math.round(1.0 * 100)) | 0;
const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 10000) / 10000;
};

const vocalNotes = manager._generateVocalNotes(
    data.stems.vocal_phrases,
    data.stems.vocals,
    diffConfig, 5, duration, skipLeadIn, skipEnd, rng
);

console.log('Vocal notes before gap-fill:', vocalNotes.length);
const vSorted = vocalNotes.sort((a, b) => a.time - b.time);

// Find all gaps > 2.5s
const times = vSorted.map(n => n.time);
console.log('\nGaps > 2.5s in vocal notes:');
for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i-1];
    if (gap > 2.5) {
        console.log(`  ${times[i-1].toFixed(2)}s → ${times[i].toFixed(2)}s = ${gap.toFixed(1)}s`);
    }
}
// Check start gap
if (times[0] > 2.5 + 1.5) {
    console.log(`  START gap: 1.5s → ${times[0].toFixed(2)}s = ${(times[0] - 1.5).toFixed(1)}s`);
}
// Check end gap
console.log(`\nLast vocal note: ${times[times.length-1].toFixed(2)}s`);
console.log(`Playable end: ${(duration - skipEnd).toFixed(1)}s`);
const endGap = (duration - skipEnd) - times[times.length-1];
console.log(`End gap: ${endGap.toFixed(1)}s (${endGap > 2.5 ? 'WOULD NEED FILL' : 'OK'})`);

// Step 2: Now manually run the gap-filler with instrumented version
console.log('\n--- Running gap-fill manually ---');
const mixOnsets = data.onsets.filter(o =>
    o.time >= skipLeadIn && o.time <= duration - skipEnd && o.strength > 0.05
);

// Replicate _fillGapsFromMix logic by hand
const gapThreshold = 2.5;
const minGap = 0.12; // hard difficulty
const gaps = [];

// Sort notes
const notesCopy = [...vSorted];
notesCopy.sort((a, b) => a.time - b.time);
const sortedTimes = notesCopy.map(n => n.time);

for (let i = 1; i < sortedTimes.length; i++) {
    const gapSize = sortedTimes[i] - sortedTimes[i - 1];
    if (gapSize > gapThreshold) {
        gaps.push({ start: sortedTimes[i - 1], end: sortedTimes[i] });
    }
}
if (sortedTimes.length > 0 && sortedTimes[0] > gapThreshold + 1.5) {
    gaps.push({ start: 1.5, end: sortedTimes[0] });
}

console.log('Gaps found by filler:', gaps.length);
for (const g of gaps) {
    console.log(`  ${g.start.toFixed(2)}s → ${g.end.toFixed(2)}s = ${(g.end - g.start).toFixed(1)}s`);
    
    // Check what mix onsets are available in this gap
    const padding = 0.3;
    const gapOnsets = mixOnsets.filter(o =>
        o.time > g.start + padding && o.time < g.end - padding
    );
    console.log(`    Mix onsets available: ${gapOnsets.length}`);
    if (gapOnsets.length > 0) {
        console.log(`    First: ${gapOnsets[0].time.toFixed(2)}s, Last: ${gapOnsets[gapOnsets.length-1].time.toFixed(2)}s`);
    }
}
