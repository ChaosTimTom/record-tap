/**
 * Beat map system – uses pre-computed analysis (JSON) from analyze_songs.py.
 *
 * The analyser outputs per-stem onset data with DURATION info:
 *   { time, strength, duration } per onset
 *
 * For vocals, a separate "vocal_phrases" array has word/phrase boundaries
 * with start time + duration for creating hold notes.
 *
 * Chart generation approach (Guitar Hero / Rock Band style):
 *   1. Vocals: map word boundaries → hold notes (harder diffs hold full word)
 *   2. Instruments: use duration for sustained notes → holds; strong simultaneous
 *      events → chord (multi-button) presses
 *   3. Difficulty controls COMPLEXITY (chords, holds, density) not just density:
 *      - Beginner: sparse single taps only
 *      - Easy: more taps, short holds introduced
 *      - Medium: holds + occasional chords (2 buttons)
 *      - Hard: full holds + frequent chords (2-3 buttons)
 *
 * Beat map note format:
 *   { time, lane: 0-4, type: 'tap'|'hold', holdDuration?: seconds }
 */

class BeatMapManager {
    constructor() {
        this.maps = {};
        this.analysisCache = {};
        this.chartCache = {};
    }

    sidecarPath(audioFilePath, extension) {
        if (!audioFilePath) return audioFilePath;
        if (/\.[a-z0-9]+$/i.test(audioFilePath)) {
            return audioFilePath.replace(/\.[a-z0-9]+$/i, extension);
        }
        return `${audioFilePath}${extension}`;
    }

    register(songId, beatMap) {
        this.maps[songId] = beatMap;
    }

    get(songId) {
        const map = this.maps[songId];
        if (!map) return null;
        return map.map(note => ({ ...note }));
    }

    async loadAnalysis(audioFilePath) {
        if (this.analysisCache[audioFilePath]) return this.analysisCache[audioFilePath];
        const jsonPath = this.sidecarPath(audioFilePath, '.json');
        try {
            const resp = await fetch(jsonPath);
            if (!resp.ok) return null;
            const data = await resp.json();
            this.analysisCache[audioFilePath] = data;
            return data;
        } catch (e) {
            console.warn('[BeatMap] Could not load analysis:', jsonPath, e);
            return null;
        }
    }

    async loadChart(audioFilePath) {
        if (this.chartCache[audioFilePath]) return this.chartCache[audioFilePath];
        const chartPath = this.sidecarPath(audioFilePath, '.chart.json');
        try {
            const resp = await fetch(chartPath);
            if (!resp.ok) return null;
            const data = await resp.json();
            this.chartCache[audioFilePath] = data;
            return data;
        } catch (e) {
            console.warn('[BeatMap] Could not load chart:', chartPath, e);
            return null;
        }
    }

    getChartNotes(songId, chartData, difficultyId, instrument) {
        if (!chartData || !chartData.charts) return [];
        const inst = instrument || 'mix';
        const diff = difficultyId || 'easy';

        const instrumentCharts = chartData.charts[inst] || chartData.charts.mix;
        if (!instrumentCharts) return [];

        const notes = instrumentCharts[diff] || instrumentCharts.easy || [];
        const key = `${songId}:${diff}:${inst}`;
        this.register(key, notes);
        return notes.map(note => ({ ...note }));
    }

    /**
     * Generate beat map from pre-computed onset analysis.
     * Uses duration data for hold notes and strength data for chord mapping.
     */
    generateFromAnalysis(songId, analysis, diffConfig, instrument) {
        const { bpm, duration, beats, downbeats } = analysis;
        const freq = diffConfig.noteFrequency || 0.5;
        const lanes = diffConfig.lanes || 5;
        const skipLeadIn = 1.5;
        const skipEnd = 1.0;

        // === Choose onset source ===
        const isVocals = (instrument === 'vocals');
        let onsets;
        let vocalPhrases = null;

        if (isVocals && analysis.stems && analysis.stems.vocal_phrases &&
            analysis.stems.vocal_phrases.length > 0) {
            // Vocals: use phrase data (word boundaries with durations) as primary
            vocalPhrases = analysis.stems.vocal_phrases;
            // Also get regular onsets as fallback for tap-only beginner mode
            onsets = (analysis.stems.vocals && analysis.stems.vocals.length > 0)
                ? analysis.stems.vocals
                : vocalPhrases;
            console.log(`[BeatMap] Vocals: ${vocalPhrases.length} phrases, ${onsets.length} onsets`);
        } else if (instrument && instrument !== 'mix' && analysis.stems &&
                   analysis.stems[instrument] && analysis.stems[instrument].length > 0) {
            onsets = analysis.stems[instrument];
            console.log(`[BeatMap] Using ${instrument} stem: ${onsets.length} onsets`);
        } else {
            onsets = analysis.onsets || [];
            console.log(`[BeatMap] Using full mix: ${onsets.length} onsets`);
        }

        // Playable range
        const playable = onsets.filter(o =>
            o.time >= skipLeadIn && o.time <= duration - skipEnd && o.strength > 0
        );

        if (playable.length === 0) {
            const key = `${songId}:${diffConfig.id}:${instrument || 'mix'}`;
            this.register(key, []);
            console.warn(`[BeatMap] No onsets for ${songId}`);
            return [];
        }

        // Seeded PRNG
        let seed = 0;
        for (let i = 0; i < songId.length; i++) {
            seed = ((seed << 5) - seed) + songId.charCodeAt(i);
            seed |= 0;
        }
        seed = (seed * 31 + Math.round(freq * 100)) | 0;
        const rng = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return (seed % 10000) / 10000;
        };

        let notes;

        if (isVocals && vocalPhrases) {
            notes = this._generateVocalNotes(vocalPhrases, playable, diffConfig, lanes, duration, skipLeadIn, skipEnd, rng);
        } else {
            notes = this._generateInstrumentNotes(playable, diffConfig, lanes, instrument, rng);
        }

        // Compute effective end: last onset across ALL available data
        // (avoids generating/fill-seeking into dead silence at end of WAV)
        let effectiveEnd = duration - skipEnd;
        const allAvailableOnsets = analysis.onsets || [];
        if (allAvailableOnsets.length > 0) {
            const lastOnsetTime = allAvailableOnsets[allAvailableOnsets.length - 1].time;
            // If the last audio onset is much earlier than duration - skipEnd,
            // cap the effective end so we don't create unfillable gaps
            effectiveEnd = Math.min(effectiveEnd, lastOnsetTime + 2.0);
        }

        // Only fill gaps when playing full mix — for specific instruments,
        // if the instrument is silent, there should be no notes.
        // Gap-fillers from random mix onsets are what make notes feel unconnected.
        if (instrument === 'mix' || !instrument) {
            if (analysis.onsets) {
                const mixOnsets = analysis.onsets.filter(o =>
                    o.time >= skipLeadIn && o.time <= effectiveEnd && o.strength > 0.05
                );
                notes = this._fillGapsFromMix(notes, mixOnsets, diffConfig, lanes, effectiveEnd, rng);
            }

            if (analysis.beats && analysis.beats.length > 0) {
                notes = this._fillGapsFromBeats(notes, analysis.beats, diffConfig, lanes, effectiveEnd, rng);
            }
        }

        notes.sort((a, b) => a.time - b.time);

        const instLabel = instrument || 'mix';
        const holdCount = notes.filter(n => n.type === 'hold').length;
        const chordTimes = new Set(notes.filter((n, i, arr) =>
            arr.some((m, j) => j !== i && Math.abs(m.time - n.time) < 0.01)
        ).map(n => n.time));
        console.log(`[BeatMap] ${songId} [${instLabel}]: ${notes.length} notes (${holdCount} holds, ${chordTimes.size} chord moments)`);

        const key = `${songId}:${diffConfig.id}:${instLabel}`;
        this.register(key, notes);
        return notes;
    }

    /**
     * Vocal chart: uses ALL vocal onsets as the base (same density as
     * instruments) and enriches onsets near phrase starts with hold
     * duration data from vocal_phrases.
     */
    _generateVocalNotes(phrases, tapOnsets, diffConfig, lanes, duration, skipLeadIn, skipEnd, rng) {
        const freq = diffConfig.noteFrequency || 0.5;
        const notes = [];

        // Filter to playable range
        const playablePhrases = phrases.filter(p =>
            p.time >= skipLeadIn && p.time <= duration - skipEnd && p.strength > 0
        );
        const playableTaps = tapOnsets.filter(o =>
            o.time >= skipLeadIn && o.time <= duration - skipEnd && o.strength > 0.05
        );

        if (playableTaps.length === 0 && playablePhrases.length === 0) return [];

        // Difficulty controls which onsets become notes via percentile filtering:
        // Only the STRONGEST onsets make the cut — weaker ones are stem artifacts.
        //   Beginner: top 15% (only the most obvious vocal moments)
        //   Easy:     top 30%
        //   Medium:   top 50%
        //   Hard:     top 75%
        let useHolds, minHoldDuration, minGap, keepPct;
        if (freq <= 0.3) {
            useHolds = false; minHoldDuration = 999; minGap = 0.80; keepPct = 0.15;
        } else if (freq <= 0.5) {
            useHolds = true; minHoldDuration = 0.5; minGap = 0.50; keepPct = 0.30;
        } else if (freq <= 0.8) {
            useHolds = true; minHoldDuration = 0.3; minGap = 0.30; keepPct = 0.50;
        } else {
            useHolds = true; minHoldDuration = 0.2; minGap = 0.18; keepPct = 0.75;
        }

        // Compute strength cutoff from percentile
        const allStrengths = playableTaps.map(o => o.strength).sort((a, b) => a - b);
        const cutoffIdx = Math.floor(allStrengths.length * (1 - keepPct));
        const strengthFloor = allStrengths[cutoffIdx] || 0.1;

        // === Use ALL vocal onsets as base, enrich with phrase durations ===
        // Build a lookup: for each phrase, find the nearest vocal onset
        // and assign it that phrase's duration (for hold notes)
        const holdDurations = new Map(); // onset time -> duration
        for (const p of playablePhrases) {
            if (!p.duration || p.duration < minHoldDuration) continue;
            // Find the closest tap onset within 0.2s of phrase start
            let closest = null;
            let closestDist = 0.2;
            for (const o of playableTaps) {
                const dist = Math.abs(o.time - p.time);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = o;
                }
            }
            if (closest) {
                // Store duration keyed by rounded time
                const key = Math.round(closest.time * 1000);
                const existing = holdDurations.get(key);
                if (!existing || p.duration > existing) {
                    holdDurations.set(key, Math.min(p.duration, 3.0));
                }
            }
        }

        // Use all vocal onsets (same as instrument path)
        const real = playableTaps.filter(o => o.strength >= strengthFloor)
            .sort((a, b) => a.time - b.time);

        // Enforce minimum gap (start-to-start)
        const gapped = [];
        for (const o of real) {
            const prev = gapped[gapped.length - 1];
            if (!prev || o.time - prev.time >= minGap) {
                gapped.push(o);
            } else if (o.strength > prev.strength) {
                gapped[gapped.length - 1] = o;
            }
        }

        // Assign lanes — follow vocal phrase contour so lanes feel melodic
        const maxStrength = Math.max(...gapped.map(o => o.strength), 0.1);
        let lastLane = -1;
        for (const o of gapped) {
            let lane;
            // Find which vocal phrase this onset belongs to
            const pIdx = playablePhrases.findIndex(p =>
                o.time >= p.time - 0.1 && o.time <= p.time + (p.duration || 1.0) + 0.1
            );
            if (pIdx >= 0) {
                // Sweep across lanes as phrase progresses (alternating direction)
                const p = playablePhrases[pIdx];
                const pDur = Math.max(p.duration || 1.0, 0.5);
                const pos = Math.max(0, Math.min(1, (o.time - p.time) / pDur));
                const mapped = (pIdx % 2 === 0) ? pos : (1 - pos);
                lane = Math.min(lanes - 1, Math.floor(mapped * lanes));
            } else {
                // Outside any phrase — map strength to lane
                lane = Math.min(lanes - 1, Math.floor((o.strength / maxStrength) * lanes));
            }
            // Smooth: cap at 2-lane jumps for natural movement
            if (lastLane >= 0 && Math.abs(lane - lastLane) > 2) {
                lane = lastLane + (lane > lastLane ? 2 : -2);
                lane = Math.max(0, Math.min(lanes - 1, lane));
            }
            lastLane = lane;

            // Check if this onset has a phrase duration → hold note
            const key = Math.round(o.time * 1000);
            const holdDur = holdDurations.get(key);
            const isHold = useHolds && holdDur && holdDur >= minHoldDuration;

            if (isHold) {
                notes.push({
                    time: Math.round(o.time * 1000) / 1000,
                    lane,
                    type: 'hold',
                    holdDuration: Math.round(holdDur * 1000) / 1000,
                });
            } else {
                notes.push({
                    time: Math.round(o.time * 1000) / 1000,
                    lane,
                    type: 'tap',
                });
            }
        }

        return notes;
    }

    /**
     * Instrument chart: onset-based with duration for holds and
     * strength-based chord (multi-button) creation.
     * - Beginner: sparse single taps
     * - Easy: more taps, introduce holds on sustained notes
     * - Medium: holds + occasional chords (2 buttons on strong hits)
     * - Hard: full holds + frequent chords (2-3 buttons)
     */
    _generateInstrumentNotes(playable, diffConfig, lanes, instrument, rng) {
        const freq = diffConfig.noteFrequency || 0.5;
        const notes = [];

        // Difficulty controls which onsets become notes via percentile filtering:
        // Only the STRONGEST onsets make the cut — weaker ones are stem artifacts.
        //   Beginner: top 15%   Easy: top 30%   Medium: top 50%   Hard: top 75%
        let useHolds, minHoldDuration, useChords, chordThreshold, maxChordSize, minGap, keepPct;
        if (freq <= 0.3) {
            useHolds = false; minHoldDuration = 999; minGap = 0.80; keepPct = 0.15;
            useChords = false; chordThreshold = 999; maxChordSize = 1;
        } else if (freq <= 0.5) {
            useHolds = true; minHoldDuration = 0.5; minGap = 0.50; keepPct = 0.30;
            useChords = false; chordThreshold = 999; maxChordSize = 1;
        } else if (freq <= 0.8) {
            useHolds = true; minHoldDuration = 0.3; minGap = 0.30; keepPct = 0.50;
            useChords = true; chordThreshold = 0.75; maxChordSize = 2;
        } else {
            useHolds = true; minHoldDuration = 0.2; minGap = 0.18; keepPct = 0.75;
            useChords = true; chordThreshold = 0.60; maxChordSize = 3;
        }

        // Compute strength cutoff from percentile of available onsets
        const allStrengths = playable.map(o => o.strength).sort((a, b) => a - b);
        const cutoffIdx = Math.floor(allStrengths.length * (1 - keepPct));
        const strengthFloor = allStrengths[cutoffIdx] || 0.1;

        // Filter noise, keep all real onsets, sort chronologically
        const real = playable.filter(o => o.strength >= strengthFloor)
            .sort((a, b) => a.time - b.time);

        // Enforce minimum gap (start-to-start — NOT end-to-start,
        // because audio duration != gameplay lock-out)
        const gapped = [];
        for (const o of real) {
            const prev = gapped[gapped.length - 1];
            if (!prev || o.time - prev.time >= minGap) {
                gapped.push(o);
            } else if (o.strength > prev.strength) {
                gapped[gapped.length - 1] = o;
            }
        }

        // Assign lanes — strength-based for consistent musical mapping
        const maxStrength = Math.max(...gapped.map(o => o.strength), 0.1);
        let lastLane = -1;
        const isDrums = (instrument === 'drums');

        for (let i = 0; i < gapped.length; i++) {
            const o = gapped[i];
            const prevGap = i > 0 ? o.time - gapped[i - 1].time : 999;

            let lane;
            if (prevGap < 0.22 && lastLane >= 0) {
                // Fast consecutive → adjacent lane (stream pattern)
                const dir = rng() > 0.5 ? 1 : -1;
                lane = lastLane + dir;
                if (lane < 0 || lane >= lanes) lane = lastLane - dir;
                lane = Math.max(0, Math.min(lanes - 1, lane));
            } else {
                // Map strength → lane (same strength = same lane = consistent feel)
                lane = Math.min(lanes - 1, Math.floor((o.strength / maxStrength) * lanes));
            }
            // Smooth: cap at 2-lane jump for non-fast sequences
            if (lastLane >= 0 && prevGap >= 0.22 && Math.abs(lane - lastLane) > 2) {
                lane = lastLane + (lane > lastLane ? 2 : -2);
                lane = Math.max(0, Math.min(lanes - 1, lane));
            }
            lastLane = lane;

            // Determine note type
            const hasDuration = o.duration && o.duration > 0;
            const isHold = useHolds && !isDrums && hasDuration && o.duration >= minHoldDuration;

            if (isHold) {
                notes.push({
                    time: Math.round(o.time * 1000) / 1000,
                    lane,
                    type: 'hold',
                    holdDuration: Math.round(Math.min(o.duration, 2.0) * 1000) / 1000,
                });
            } else {
                notes.push({
                    time: Math.round(o.time * 1000) / 1000,
                    lane,
                    type: 'tap',
                });
            }

            // Chord: add extra simultaneous notes on strong hits
            if (useChords && o.strength >= chordThreshold) {
                const extraNotes = Math.min(maxChordSize - 1, lanes - 1);
                const usedLanes = [lane];

                for (let c = 0; c < extraNotes; c++) {
                    const available = Array.from({ length: lanes }, (_, j) => j)
                        .filter(l => !usedLanes.includes(l));
                    if (available.length === 0) break;

                    // Prefer adjacent lanes for natural chord feel
                    let chordLane;
                    const adjacent = available.filter(l => Math.abs(l - lane) <= 2);
                    if (adjacent.length > 0 && rng() > 0.3) {
                        chordLane = adjacent[Math.floor(rng() * adjacent.length)];
                    } else {
                        chordLane = available[Math.floor(rng() * available.length)];
                    }

                    usedLanes.push(chordLane);
                    notes.push({
                        time: Math.round(o.time * 1000) / 1000,
                        lane: chordLane,
                        type: isHold ? 'hold' : 'tap',
                        holdDuration: isHold ? Math.round(Math.min(o.duration, 2.0) * 1000) / 1000 : undefined,
                    });
                }
            }
        }

        return notes;
    }

    /**
     * Fill gaps in generated notes using full-mix onsets.
     * When a stem is silent (e.g. vocal instrumental break) but the
     * band is still playing, pull in mix onsets as tap notes so
     * the player always has something to do during active music.
     */
    _fillGapsFromMix(notes, mixOnsets, diffConfig, lanes, effectiveEnd, rng) {
        if (!mixOnsets || mixOnsets.length === 0) return notes;

        const freq = diffConfig.noteFrequency || 0.5;
        const gapThreshold = 2.5; // Only fill gaps bigger than this
        let minGap;
        if (freq <= 0.3) { minGap = 0.55; }
        else if (freq <= 0.5) { minGap = 0.35; }
        else if (freq <= 0.8) { minGap = 0.20; }
        else { minGap = 0.12; }

        // Sort existing notes by time
        notes.sort((a, b) => a.time - b.time);

        // Find gaps > threshold
        const gaps = [];
        const times = notes.map(n => n.time);
        for (let i = 1; i < times.length; i++) {
            const gapSize = times[i] - times[i - 1];
            if (gapSize > gapThreshold) {
                gaps.push({ start: times[i - 1], end: times[i] });
            }
        }
        // Check gap at start
        if (times.length > 0 && times[0] > gapThreshold + 1.5) {
            gaps.push({ start: 1.5, end: times[0] });
        }
        // Check gap at end of song
        if (times.length > 0 && effectiveEnd - times[times.length - 1] > gapThreshold) {
            gaps.push({ start: times[times.length - 1], end: effectiveEnd });
        }

        if (gaps.length === 0) return notes;

        console.log(`[BeatMap] Filling ${gaps.length} gaps from mix onsets`);

        // For each gap, inject mix onsets as taps
        const fillers = [];
        let lastLane = -1;

        for (const gap of gaps) {
            // Get mix onsets inside this gap (with small padding)
            const padding = 0.3;
            const gapOnsets = mixOnsets.filter(o =>
                o.time > gap.start + padding && o.time < gap.end - padding
            ).sort((a, b) => a.time - b.time);

            // Enforce minGap within filler notes
            let lastTime = gap.start;
            for (const o of gapOnsets) {
                if (o.time - lastTime < minGap) continue;
                lastTime = o.time;

                // Lane assignment
                let lane = Math.floor(rng() * lanes);
                if (lane === lastLane && rng() > 0.3) {
                    const alt = Array.from({ length: lanes }, (_, j) => j).filter(l => l !== lastLane);
                    lane = alt[Math.floor(rng() * alt.length)];
                }
                lastLane = lane;

                fillers.push({
                    time: Math.round(o.time * 1000) / 1000,
                    lane,
                    type: 'tap',
                });
            }
        }

        if (fillers.length > 0) {
            console.log(`[BeatMap] Added ${fillers.length} gap-filler notes from mix`);
        }

        return notes.concat(fillers);
    }

    /**
     * Last-resort gap fill using beats/downbeats.
     * Handles dead tails and any remaining gaps where even the mix
     * had no onsets (genuine silence in the audio, but we still want
     * a few notes so gameplay doesn't stall).
     */
    _fillGapsFromBeats(notes, beats, diffConfig, lanes, effectiveEnd, rng) {
        if (!beats || beats.length === 0) return notes;

        const freq = diffConfig.noteFrequency || 0.5;
        const gapThreshold = 3.0; // Higher threshold — only truly dead zones
        let minGap;
        if (freq <= 0.3) { minGap = 1.0; }
        else if (freq <= 0.5) { minGap = 0.7; }
        else if (freq <= 0.8) { minGap = 0.5; }
        else { minGap = 0.35; }

        notes.sort((a, b) => a.time - b.time);

        const gaps = [];
        const times = notes.map(n => n.time);
        for (let i = 1; i < times.length; i++) {
            const gapSize = times[i] - times[i - 1];
            if (gapSize > gapThreshold) {
                gaps.push({ start: times[i - 1], end: times[i] });
            }
        }
        if (times.length > 0 && times[0] > gapThreshold + 1.5) {
            gaps.push({ start: 1.5, end: times[0] });
        }
        if (times.length > 0 && effectiveEnd - times[times.length - 1] > gapThreshold) {
            gaps.push({ start: times[times.length - 1], end: effectiveEnd });
        }

        if (gaps.length === 0) return notes;

        const fillers = [];
        let lastLane = -1;

        for (const gap of gaps) {
            const padding = 0.3;
            const gapBeats = beats.filter(t =>
                t > gap.start + padding && t < gap.end - padding
            ).sort((a, b) => a - b);

            let lastTime = gap.start;
            for (const t of gapBeats) {
                if (t - lastTime < minGap) continue;
                lastTime = t;

                let lane = Math.floor(rng() * lanes);
                if (lane === lastLane && rng() > 0.3) {
                    const alt = Array.from({ length: lanes }, (_, j) => j).filter(l => l !== lastLane);
                    lane = alt[Math.floor(rng() * alt.length)];
                }
                lastLane = lane;

                fillers.push({
                    time: Math.round(t * 1000) / 1000,
                    lane,
                    type: 'tap',
                });
            }
        }

        if (fillers.length > 0) {
            console.log(`[BeatMap] Added ${fillers.length} beat-based gap-filler notes`);
        }

        return notes.concat(fillers);
    }

    /* ── Fallback: BPM-based generation for demo tracks ────────── */

    generateFromBPM(songId, bpm, duration, diffConfig) {
        const notes = [];
        const beatInterval = 60 / bpm;
        const activeLanes = diffConfig.lanes || 5;
        const freq = diffConfig.noteFrequency || 0.5;
        let time = beatInterval * 2;

        let seed = 0;
        for (let i = 0; i < songId.length; i++) {
            seed = ((seed << 5) - seed) + songId.charCodeAt(i);
            seed |= 0;
        }
        seed = (seed * 31 + activeLanes * 7 + Math.round(freq * 100)) | 0;
        const pseudoRandom = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return (seed % 1000) / 1000;
        };

        const endTime = duration - 2;
        while (time < endTime) {
            const lane = Math.floor(pseudoRandom() * activeLanes);
            notes.push({ time: Math.round(time * 1000) / 1000, lane, type: 'tap' });

            if (diffConfig.doubleNotes && pseudoRandom() < (diffConfig.doubleChance || 0)) {
                let lane2 = (lane + 1 + Math.floor(pseudoRandom() * (activeLanes - 1))) % activeLanes;
                notes.push({ time: Math.round(time * 1000) / 1000, lane: lane2, type: 'tap' });
            }
            if (diffConfig.holdNotes && pseudoRandom() < (diffConfig.holdChance || 0)) {
                const holdLane = Math.floor(pseudoRandom() * activeLanes);
                notes.push({
                    time: Math.round((time + beatInterval) * 1000) / 1000,
                    lane: holdLane, type: 'hold',
                    holdDuration: beatInterval * (1 + Math.floor(pseudoRandom() * 3)),
                });
            }

            const step = beatInterval / freq;
            time += (pseudoRandom() > 0.3) ? step : step * 2;
        }

        notes.sort((a, b) => a.time - b.time);
        const key = `${songId}:${diffConfig.id}`;
        this.register(key, notes);
        return notes;
    }
}

window.BeatMapManager = BeatMapManager;
