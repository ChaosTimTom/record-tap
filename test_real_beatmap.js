/**
 * Run real beatmap.js generation in Node and dump results.
 * This tests THE ACTUAL CODE, not a Python simulation.
 */
const fs = require('fs');
const path = require('path');

// Load beatmap.js source and eval it (it adds BeatMapManager to global)
const src = fs.readFileSync(path.join(__dirname, 'js', 'beatmap.js'), 'utf-8');
global.window = {};
eval(src);
const BeatMapManager = global.window.BeatMapManager;

// Load a song analysis
const songFile = 'songs/downs-east/Lobstah Life.json';
const analysis = JSON.parse(fs.readFileSync(songFile, 'utf-8'));
const bm = new BeatMapManager();

const diffs = [
    { id: 'beginner', noteFrequency: 0.25, lanes: 5 },
    { id: 'easy',     noteFrequency: 0.45, lanes: 5 },
    { id: 'medium',   noteFrequency: 0.70, lanes: 5 },
    { id: 'hard',     noteFrequency: 1.00, lanes: 5 },
];

console.log(`Song: Lobstah Life (${analysis.duration.toFixed(0)}s)`);
console.log(`Vocal phrases: ${analysis.stems.vocal_phrases.length}`);
console.log(`Vocal onsets: ${analysis.stems.vocals.length}`);
console.log(`Mix onsets: ${analysis.onsets.length}`);
console.log();

for (const inst of ['vocals', 'drums', 'bass', 'other', 'mix']) {
    console.log(`=== ${inst.toUpperCase()} ===`);
    for (const diff of diffs) {
        // Clear cache so it regenerates
        bm.maps = {};
        bm.analysisCache = {};
        const notes = bm.generateFromAnalysis('lobstah', analysis, diff, inst);
        
        // Compute gaps
        const times = notes.map(n => n.time).sort((a, b) => a - b);
        let maxGap = 0;
        let gaps3s = 0;
        for (let i = 1; i < times.length; i++) {
            const gap = times[i] - times[i-1];
            if (gap > maxGap) maxGap = gap;
            if (gap > 3) gaps3s++;
        }
        
        const holds = notes.filter(n => n.type === 'hold').length;
        const taps = notes.filter(n => n.type === 'tap').length;
        const nps = (notes.length / (analysis.duration - 2.5)).toFixed(1);
        
        console.log(`  ${diff.id.padEnd(10)} ${String(notes.length).padStart(5)} notes (${taps} taps, ${holds} holds) | ${nps}/s | maxGap=${maxGap.toFixed(1)}s gaps>3s=${gaps3s}`);
    }
    console.log();
}
