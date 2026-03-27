// Targeted test: Does _fillGapsFromMix actually work on Deckhands' Delight vocals?
const fs = require('fs');

// Load the real BeatMapManager
const code = fs.readFileSync('js/beatmap.js', 'utf8')
    .replace('window.BeatMapManager = BeatMapManager;', 'module.exports = BeatMapManager;');
const BeatMapManager = eval(code + '\nBeatMapManager;');

const data = JSON.parse(fs.readFileSync("songs/downs-east/Deckhands' Delight.json", 'utf8'));

const manager = new BeatMapManager();

// Run for vocals/hard to get max notes
const diffConfig = { id: 'hard', noteFrequency: 1.0, lanes: 5, timingWindow: 0.75 };
const notes = manager.generateFromAnalysis("Deckhands' Delight", data, diffConfig, 'vocals');

console.log('Total notes:', notes.length);

// Check gap region 207-220
const sorted = notes.sort((a, b) => a.time - b.time);
const inGap = sorted.filter(n => n.time >= 207 && n.time <= 220);
console.log('Notes in 207-220s region:', inGap.length);

// Find the actual gap
for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].time - sorted[i-1].time;
    if (gap > 2.0) {
        console.log(`  Gap: ${sorted[i-1].time.toFixed(2)}s → ${sorted[i].time.toFixed(2)}s = ${gap.toFixed(1)}s`);
    }
}

// Now let's trace what _fillGapsFromMix does
console.log('\n--- Manual gap-fill trace ---');
const skipLeadIn = 1.5;
const skipEnd = 1.0;
const duration = data.duration;

// Simulate the gap-fill call
const mixOnsets = data.onsets.filter(o =>
    o.time >= skipLeadIn && o.time <= duration - skipEnd && o.strength > 0.05
);
console.log('Total mix onsets available:', mixOnsets.length);

// Get the notes BEFORE gap-fill by regenerating without it
// We'll manually call _generateVocalNotes
const vocalPhrases = data.stems.vocal_phrases;
const tapOnsets = data.stems.vocals;
const playablePhrases = vocalPhrases.filter(p => p.time >= skipLeadIn && p.time <= duration - skipEnd && p.strength > 0);
const playableTaps = tapOnsets.filter(o => o.time >= skipLeadIn && o.time <= duration - skipEnd && o.strength > 0.05);

console.log('Vocal onsets (playable):', playableTaps.length);
console.log('Vocal phrases (playable):', playablePhrases.length);

// Find the last vocal onset before 207s and first after 207s
const beforeGap = playableTaps.filter(o => o.time <= 210).sort((a,b) => b.time - a.time);
const afterGap = playableTaps.filter(o => o.time >= 207).sort((a,b) => a.time - b.time);
console.log('Last vocal onset before gap:', beforeGap[0] ? beforeGap[0].time.toFixed(2) + 's (str: ' + beforeGap[0].strength.toFixed(3) + ')' : 'none');
console.log('First vocal onset after gap:', afterGap[0] ? afterGap[0].time.toFixed(2) + 's (str: ' + afterGap[0].strength.toFixed(3) + ')' : 'none');
if (afterGap[1]) console.log('Second vocal onset after gap:', afterGap[1].time.toFixed(2) + 's (str: ' + afterGap[1].strength.toFixed(3) + ')');
if (afterGap[2]) console.log('Third vocal onset after gap:', afterGap[2].time.toFixed(2) + 's (str: ' + afterGap[2].strength.toFixed(3) + ')');

// Check mix onsets in the 207-220 region
const mixInGap = mixOnsets.filter(o => o.time >= 207 && o.time <= 220);
console.log('\nMix onsets in 207-220s:', mixInGap.length);
if (mixInGap.length > 0) {
    console.log('First 10:', mixInGap.slice(0, 10).map(o => o.time.toFixed(2) + '(' + o.strength.toFixed(2) + ')').join(', '));
}

// Check: does the gap-filler find this gap?
const noteTimes = sorted.map(n => n.time);
console.log('\nNote around gap region (200-220):');
const nearGap = sorted.filter(n => n.time >= 200 && n.time <= 225);
for (const n of nearGap) {
    console.log(`  t=${n.time.toFixed(2)} lane=${n.lane} type=${n.type}`);
}
