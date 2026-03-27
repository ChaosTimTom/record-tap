// Verify key gap fixes by running the REAL updated beatmap.js
const fs = require('fs');
const path = require('path');

const window = {};
eval(fs.readFileSync(path.join(__dirname, 'js/beatmap.js'), 'utf8'));
const BeatMapManager = window.BeatMapManager;

const songsDir = path.join(__dirname, 'songs', 'downs-east');
const diffHard = { id: 'hard', noteFrequency: 1.0, lanes: 5, timingWindow: 0.75 };

function checkSong(name, instrument) {
    const jsonPath = path.join(songsDir, name + '.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const manager = new BeatMapManager();
    const notes = manager.generateFromAnalysis(name, data, diffHard, instrument);
    const sorted = notes.sort((a, b) => a.time - b.time);
    
    let maxGap = 0, maxGapStart = 0, maxGapEnd = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].time - sorted[i-1].time;
        if (gap > maxGap) {
            maxGap = gap;
            maxGapStart = sorted[i-1].time;
            maxGapEnd = sorted[i].time;
        }
    }
    
    const lastNote = sorted[sorted.length - 1].time;
    const effectiveEnd = Math.min(data.duration - 1.0, 
        (data.onsets.length > 0 ? data.onsets[data.onsets.length-1].time + 2.0 : data.duration - 1.0));
    
    console.log(`${name.padEnd(45)} | ${instrument.padEnd(7)} | ${sorted.length} notes | last=${lastNote.toFixed(1)}s | maxGap=${maxGap.toFixed(1)}s at ${maxGapStart.toFixed(1)}-${maxGapEnd.toFixed(1)} | effEnd=${effectiveEnd.toFixed(1)}s | dur=${data.duration.toFixed(1)}s`);
    
    if (maxGap > 3.0) {
        console.log(`  >>> WARNING: ${maxGap.toFixed(1)}s gap`);
    }
}

console.log('=== Previously problematic songs (mid-song gaps) ===');
checkSong("Deckhands' Delight", 'vocals');  // Was 11.9s gap
checkSong("New Paint on the Old Pier", 'vocals');  // Was 9.1s gap
checkSong("When the Woods Come to Town", 'vocals');  // Was 7.3s gap
checkSong("Lobster Pots and Minivans Mastered full", 'vocals');  // Was 8.9s gap
checkSong("Lobster Pots and Minivans Mastered full", 'drums');  // Was 10.7s gap
checkSong("Lobster Pots and Minivans Mastered full", 'mix');  // Was 5.8s gap

console.log('\n=== Dead tail songs ===');
checkSong("The Inspection Sticker Blues (Edit)", 'vocals');  // 8.4s dead tail
checkSong("The Inspection Sticker Blues (Edit)", 'mix');
checkSong("Blueberries and Beer", 'mix');
checkSong("Downeast Trap", 'mix');
checkSong("Ghosts of Route 1", 'drums');
checkSong("The Old Woodshed (Edit)", 'mix');
