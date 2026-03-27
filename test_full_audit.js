/**
 * Full audit: run the REAL beatmap.js code on all 20 songs × 5 instruments × 4 difficulties.
 * For each combination, verify:
 *   1. Note count and density
 *   2. Gaps > 2s, > 3s, > 5s
 *   3. 10-second window analysis (find dead zones)
 *   4. Coverage: what % of active audio sections have notes
 *   5. Vocal onset alignment: are notes placed where vocals actually exist?
 *   6. Timeline heatmap: activity per 10s bucket
 */

const fs = require('fs');
const path = require('path');

// Load beatmap.js via eval (same engine as browser)
const window = {};
eval(fs.readFileSync(path.join(__dirname, 'js/beatmap.js'), 'utf8'));
const BeatMapManager = window.BeatMapManager;

const DIFFS = [
    { id: 'beginner', name: 'BEGINNER', lanes: 5, noteFrequency: 0.25, timingWindow: 1.5 },
    { id: 'easy', name: 'EASY', lanes: 5, noteFrequency: 0.45, timingWindow: 1.3 },
    { id: 'medium', name: 'MEDIUM', lanes: 5, noteFrequency: 0.7, timingWindow: 1.0 },
    { id: 'hard', name: 'HARD', lanes: 5, noteFrequency: 1.0, timingWindow: 0.75 },
];

const INSTRUMENTS = ['vocals', 'drums', 'bass', 'other', 'mix'];

const songsDir = path.join(__dirname, 'songs', 'downs-east');
const jsonFiles = fs.readdirSync(songsDir).filter(f => f.endsWith('.json'));

// Suppress console.log from beatmap.js
const origLog = console.log;
const origWarn = console.warn;
let suppressLog = false;
console.log = (...args) => { if (!suppressLog) origLog(...args); };
console.warn = (...args) => { if (!suppressLog) origWarn(...args); };

function analyzeNotes(notes, duration) {
    if (notes.length === 0) return { count: 0, density: 0, gaps: [], maxGap: 0, gaps2s: 0, gaps3s: 0, gaps5s: 0, deadZones: [], buckets: [] };

    const sorted = [...notes].sort((a, b) => a.time - b.time);
    const count = sorted.length;
    const playTime = duration - 2.5; // 1.5 lead-in + 1.0 end
    const density = count / playTime;

    // Find gaps
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].time - sorted[i - 1].time;
        if (gap > 2.0) {
            gaps.push({ start: sorted[i - 1].time, end: sorted[i].time, size: gap });
        }
    }
    // Gap at start
    if (sorted[0].time > 3.5) {
        gaps.push({ start: 1.5, end: sorted[0].time, size: sorted[0].time - 1.5 });
    }
    // Gap at end
    const lastNote = sorted[sorted.length - 1].time;
    if (duration - 1.0 - lastNote > 3.0) {
        gaps.push({ start: lastNote, end: duration - 1.0, size: duration - 1.0 - lastNote });
    }

    const maxGap = gaps.length > 0 ? Math.max(...gaps.map(g => g.size)) : 0;
    const gaps2s = gaps.filter(g => g.size > 2).length;
    const gaps3s = gaps.filter(g => g.size > 3).length;
    const gaps5s = gaps.filter(g => g.size > 5).length;

    // 10-second bucket analysis
    const bucketSize = 10;
    const numBuckets = Math.ceil(duration / bucketSize);
    const buckets = [];
    for (let i = 0; i < numBuckets; i++) {
        const start = i * bucketSize;
        const end = start + bucketSize;
        const notesInBucket = sorted.filter(n => n.time >= start && n.time < end).length;
        buckets.push({ start, end: Math.min(end, duration), notes: notesInBucket });
    }

    // Dead zones: 10s windows with 0 notes (excluding lead-in and end)
    const deadZones = buckets.filter(b => b.notes === 0 && b.start >= 1.5 && b.end <= duration - 1.0);

    return { count, density, gaps, maxGap, gaps2s, gaps3s, gaps5s, deadZones, buckets };
}

function analyzeVocalCoverage(notes, analysis) {
    if (!analysis.stems || !analysis.stems.vocals) return null;

    const vocalOnsets = analysis.stems.vocals.filter(o => o.time >= 1.5 && o.strength > 0.05);
    if (vocalOnsets.length === 0) return null;

    // For each vocal onset, find if there's a note within 0.5s
    let covered = 0;
    for (const vo of vocalOnsets) {
        const hasNote = notes.some(n => Math.abs(n.time - vo.time) < 0.5);
        if (hasNote) covered++;
    }

    // Also check: for each note, is it near a vocal onset?
    let onTarget = 0;
    for (const n of notes) {
        const nearVocal = vocalOnsets.some(vo => Math.abs(vo.time - n.time) < 0.5);
        if (nearVocal) onTarget++;
    }

    return {
        totalVocalOnsets: vocalOnsets.length,
        onsetsCovered: covered,
        coveragePct: Math.round(covered / vocalOnsets.length * 100),
        notesOnVocals: onTarget,
        notesOnVocalPct: notes.length > 0 ? Math.round(onTarget / notes.length * 100) : 0,
    };
}

// ============ MAIN ============
let totalIssues = 0;
const issues = [];
const summary = [];

origLog('='.repeat(80));
origLog('FULL BEATMAP AUDIT — ALL SONGS × ALL INSTRUMENTS × ALL DIFFICULTIES');
origLog('='.repeat(80));

for (const jsonFile of jsonFiles) {
    const songName = jsonFile.replace('.json', '');
    const analysis = JSON.parse(fs.readFileSync(path.join(songsDir, jsonFile), 'utf8'));
    const songId = songName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    origLog(`\n${'━'.repeat(70)}`);
    origLog(`SONG: ${songName} (${analysis.duration.toFixed(0)}s, ${analysis.bpm} BPM)`);
    origLog(`  Raw data: ${analysis.onsets?.length || 0} mix onsets, vocals=${analysis.stems?.vocals?.length || 0}, phrases=${analysis.stems?.vocal_phrases?.length || 0}, drums=${analysis.stems?.drums?.length || 0}, bass=${analysis.stems?.bass?.length || 0}, other=${analysis.stems?.other?.length || 0}`);
    origLog(`${'━'.repeat(70)}`);

    for (const inst of INSTRUMENTS) {
        origLog(`\n  --- ${inst.toUpperCase()} ---`);

        for (const diff of DIFFS) {
            suppressLog = true;
            const bm = new BeatMapManager();
            const notes = bm.generateFromAnalysis(songId, analysis, diff, inst);
            suppressLog = false;

            const stats = analyzeNotes(notes, analysis.duration);

            // Check lane distribution
            const laneCounts = [0, 0, 0, 0, 0];
            const typeCounts = { tap: 0, hold: 0 };
            for (const n of notes) {
                laneCounts[n.lane]++;
                typeCounts[n.type]++;
            }

            let flag = '';
            if (stats.gaps3s > 0) flag += ` ⚠️ ${stats.gaps3s} gaps>3s`;
            if (stats.gaps5s > 0) flag += ` 🛑 ${stats.gaps5s} gaps>5s`;
            if (stats.deadZones.length > 0) flag += ` 💀 ${stats.deadZones.length} dead 10s zones`;
            if (stats.density < 0.5 && diff.id !== 'beginner') flag += ` ❌ LOW DENSITY`;
            if (stats.count === 0) flag += ` 🚫 NO NOTES`;

            const laneStr = laneCounts.map((c, i) => `L${i}:${c}`).join(' ');
            origLog(`    ${diff.id.padEnd(10)} ${String(stats.count).padStart(5)} notes (${typeCounts.tap} tap, ${typeCounts.hold} hold) | ${stats.density.toFixed(1)}/s | maxGap=${stats.maxGap.toFixed(1)}s | gaps>2s=${stats.gaps2s} >3s=${stats.gaps3s} >5s=${stats.gaps5s} | ${laneStr}${flag}`);

            // Vocal coverage analysis
            if (inst === 'vocals') {
                const cov = analyzeVocalCoverage(notes, analysis);
                if (cov) {
                    origLog(`             vocal coverage: ${cov.coveragePct}% of ${cov.totalVocalOnsets} vocal onsets covered | ${cov.notesOnVocalPct}% of notes near vocal audio`);
                }
            }

            // Report gaps > 3s in detail
            const bigGaps = stats.gaps.filter(g => g.size > 3.0);
            for (const g of bigGaps) {
                origLog(`             GAP: ${g.start.toFixed(1)}s → ${g.end.toFixed(1)}s (${g.size.toFixed(1)}s silent)`);
                issues.push({ song: songName, inst, diff: diff.id, msg: `${g.size.toFixed(1)}s gap at ${g.start.toFixed(1)}-${g.end.toFixed(1)}s` });
                totalIssues++;
            }

            // Report dead zones
            for (const dz of stats.deadZones) {
                origLog(`             DEAD ZONE: ${dz.start.toFixed(0)}-${dz.end.toFixed(0)}s (0 notes in 10s)`);
            }

            summary.push({
                song: songName, inst, diff: diff.id,
                count: stats.count, density: stats.density,
                maxGap: stats.maxGap, gaps3s: stats.gaps3s, gaps5s: stats.gaps5s,
                deadZones: stats.deadZones.length,
            });
        }
    }
}

// ============ FINAL SUMMARY ============
origLog('\n' + '='.repeat(80));
origLog('SUMMARY');
origLog('='.repeat(80));

// Aggregate by instrument
for (const inst of INSTRUMENTS) {
    const rows = summary.filter(r => r.inst === inst);
    for (const diff of DIFFS) {
        const dRows = rows.filter(r => r.diff === diff.id);
        const avgDensity = dRows.reduce((s, r) => s + r.density, 0) / dRows.length;
        const totalGaps3 = dRows.reduce((s, r) => s + r.gaps3s, 0);
        const totalGaps5 = dRows.reduce((s, r) => s + r.gaps5s, 0);
        const totalDead = dRows.reduce((s, r) => s + r.deadZones, 0);
        const maxMaxGap = Math.max(...dRows.map(r => r.maxGap));
        const avgCount = dRows.reduce((s, r) => s + r.count, 0) / dRows.length;
        origLog(`  ${inst.padEnd(8)} ${diff.id.padEnd(10)} avg=${avgCount.toFixed(0)} notes, ${avgDensity.toFixed(1)}/s | worst gap=${maxMaxGap.toFixed(1)}s | total gaps>3s=${totalGaps3} gaps>5s=${totalGaps5} dead10s=${totalDead}`);
    }
}

origLog(`\nTOTAL ISSUES (gaps > 3s): ${totalIssues}`);
if (issues.length > 0) {
    origLog('\nALL ISSUES:');
    for (const issue of issues) {
        origLog(`  ${issue.song} | ${issue.inst} ${issue.diff}: ${issue.msg}`);
    }
}

// ============ SIMULATION: What game.js render() would show ============
origLog('\n' + '='.repeat(80));
origLog('RENDER SIMULATION — Simulating game.js render loop for vocals/medium');
origLog('='.repeat(80));

// Pick 3 representative songs
const testSongs = jsonFiles.slice(0, 3);
for (const jsonFile of testSongs) {
    const songName = jsonFile.replace('.json', '');
    const analysis = JSON.parse(fs.readFileSync(path.join(songsDir, jsonFile), 'utf8'));
    const songId = songName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    suppressLog = true;
    const bm = new BeatMapManager();
    const diff = DIFFS[2]; // medium
    const notes = bm.generateFromAnalysis(songId, analysis, diff, 'vocals');
    suppressLog = false;

    // Simulate game.js rendering at noteSpeed=5 (default)
    const noteSpeed = 5;
    const travelTime = 2.5 - (noteSpeed * 0.18); // = 1.6s
    const hitLineY = 0.82;

    origLog(`\n  ${songName} — ${notes.length} vocal notes at medium`);
    origLog(`  travelTime = ${travelTime.toFixed(2)}s (notes visible for ${(travelTime + 0.5 + 0.5).toFixed(1)}s window)`);

    // Simulate every 5 seconds: how many notes are visible on screen?
    origLog('  Time | Visible | Next note | Status');
    for (let t = 0; t <= analysis.duration; t += 5) {
        // game.js render visibility: timeDiff > travelTime + 0.5 || timeDiff < -0.5
        // timeDiff = note.time - currentTime
        // So visible when: -0.5 <= (note.time - t) <= travelTime + 0.5
        // i.e.: t - 0.5 >= note.time - travelTime - 0.5 AND note.time >= t - 0.5
        // Simplified: note.time >= t - 0.5 AND note.time <= t + travelTime + 0.5
        const visibleNotes = notes.filter(n => {
            if (n.hit || n.missed) return false; // in real game these would be set
            const timeDiff = n.time - t;
            return !(timeDiff > travelTime + 0.5 || timeDiff < -0.5);
        });

        // But in the real game, notes that passed would be "missed" — so only count future ones
        const upcomingVisible = notes.filter(n => {
            const timeDiff = n.time - t;
            return timeDiff >= -0.5 && timeDiff <= travelTime + 0.5;
        });

        const nextNote = notes.find(n => n.time > t);
        const nextDesc = nextNote ? `${(nextNote.time - t).toFixed(1)}s away (t=${nextNote.time.toFixed(1)})` : 'none';
        const status = upcomingVisible.length === 0 ? '⚠️ EMPTY SCREEN' : '';

        origLog(`  ${String(t).padStart(5)}s | ${String(upcomingVisible.length).padStart(7)} | ${nextDesc.padEnd(30)} | ${status}`);
    }
}

origLog('\n✅ Audit complete.');
