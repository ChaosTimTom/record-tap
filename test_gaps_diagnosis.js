const fs = require('fs');

function checkGapRegion(songName, gapStart, gapEnd) {
    const jsonPath = 'songs/downs-east/' + songName + '.json';
    if (!fs.existsSync(jsonPath)) { console.log('MISSING: ' + jsonPath); return; }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log('=== ' + songName + ' (duration: ' + data.duration.toFixed(1) + 's) ===');
    console.log('  Gap region: ' + gapStart + 's - ' + gapEnd + 's');
    
    // Check mix onsets in gap region
    const mixInGap = (data.onsets || []).filter(o => o.time >= gapStart && o.time <= gapEnd);
    console.log('  Mix onsets in gap: ' + mixInGap.length);
    if (mixInGap.length > 0) {
        console.log('    First: t=' + mixInGap[0].time.toFixed(2) + ' str=' + mixInGap[0].strength.toFixed(3));
        console.log('    Last:  t=' + mixInGap[mixInGap.length-1].time.toFixed(2) + ' str=' + mixInGap[mixInGap.length-1].strength.toFixed(3));
    }
    
    // Check beats/downbeats in gap region
    const beatsInGap = (data.beats || []).filter(t => t >= gapStart && t <= gapEnd);
    console.log('  Beats in gap: ' + beatsInGap.length);
    if (beatsInGap.length > 0) {
        console.log('    Beats: ' + beatsInGap.map(t => t.toFixed(2)).join(', '));
    }
    
    // Check each stem
    if (data.stems) {
        for (const stem of ['vocals', 'drums', 'bass', 'other']) {
            const stemData = data.stems[stem] || [];
            const inGap = stemData.filter(o => o.time >= gapStart && o.time <= gapEnd);
            console.log('  ' + stem + ' onsets in gap: ' + inGap.length);
        }
    }
    
    // Check last onset times
    const allOnsets = data.onsets || [];
    const lastMix = allOnsets.length ? allOnsets[allOnsets.length-1].time : 0;
    const lastVocal = data.stems && data.stems.vocals && data.stems.vocals.length ? data.stems.vocals[data.stems.vocals.length-1].time : 0;
    console.log('  Last mix onset: ' + lastMix.toFixed(2) + 's');
    console.log('  Last vocal onset: ' + lastVocal.toFixed(2) + 's');
    console.log('  skipEnd cuts at: ' + (data.duration - 1.0).toFixed(1) + 's');
    console.log('  Dead tail = ' + (data.duration - 1.0 - lastMix).toFixed(1) + 's after last mix onset');
    console.log('');
}

// End-of-song gaps (ALL instruments affected)
checkGapRegion('Blueberries and Beer', 308, 315);
checkGapRegion('Downeast Trap', 221, 228);
checkGapRegion('Ghosts of Route 1', 332, 340);
checkGapRegion('Lobster Pots and Minivans Mastered full', 227, 240);
checkGapRegion('The Inspection Sticker Blues (Edit)', 167, 178);
checkGapRegion('The Old Woodshed (Edit)', 318, 324);

// Mid-song vocal gap (only vocals)
checkGapRegion("Deckhands' Delight", 207, 221);

// Others
checkGapRegion('New Paint on the Old Pier', 266, 277);
checkGapRegion('When the Woods Come to Town', 256, 265);
checkGapRegion("Drown a Whale (Up to Camp)", 246, 252);
checkGapRegion('The Factory Ride', 264, 270);
checkGapRegion("Jasper's Beach", 258, 265);
