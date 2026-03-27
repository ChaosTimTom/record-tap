/**
 * Core gameplay engine - handles note rendering, input, scoring, and game loop.
 * Notes fall from top in 4 colored lanes. Player taps them at the hit zone.
 */
class GameEngine {
    constructor(canvas, audio, beatMapManager, singer) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.audio = audio;
        this.beatMapManager = beatMapManager;
        this.singer = singer;

        // Game state
        this.isRunning = false;
        this.isPaused = false;
        this.notes = [];
        this.song = null;
        this.bpm = 120;
        this.songDuration = 60;

        // Settings
        this.noteSpeed = 5; // 1-10
        this.timingOffset = 0; // ms

        // Scoring
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.hits = { perfect: 0, great: 0, good: 0, miss: 0, overhit: 0 };
        this.lastOverhitAt = 0;

        // Timing windows (in seconds)
        this.windows = {
            perfect: 0.045,
            great: 0.09,
            good: 0.135,
        };

        // Visual config
        this.laneCount = 5;
        this.laneColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
        this.laneGlowColors = ['rgba(239,68,68,', 'rgba(59,130,246,', 'rgba(34,197,94,', 'rgba(249,158,11,', 'rgba(168,85,247,'];
        this.shapeTypes = ['circle', 'diamond', 'square', 'triangle', 'pentagon'];
        this.hitLineY = 0.82; // % from top where the hit zone is

        // Touch / hold tracking
        this.activeTouches = new Map();
        this.heldLanes = new Set(); // lanes currently pressed (for hold notes)

        // Callbacks
        this.onHit = null;       // (type) => {}
        this.onComplete = null;  // (results) => {}
        this.onScoreChange = null; // (score, combo) => {}
        this.onOverdriveChange = null; // ({ meter, active }) => {}

        this.overdriveMeter = 0;
        this.overdriveActive = false;
        this.overdriveDrainPerSec = 0.115;
        this.overdriveActivations = 0;

        // Animation frame
        this.rafId = null;
        this.lastFrame = 0;

        this.setupInput();
    }

    setupInput() {
        // Touch input
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.audio.resume();
            for (const touch of e.changedTouches) {
                const lane = this._xToLane(touch.clientX);
                this.heldLanes.add(lane);
                this.handleLaneTap(lane);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                const lane = this._xToLane(touch.clientX);
                this.heldLanes.delete(lane);
                this.handleLaneRelease(lane);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });

        // Mouse input (for desktop testing)
        this.canvas.addEventListener('mousedown', (e) => {
            this.audio.resume();
            const lane = this._xToLane(e.clientX);
            this.heldLanes.add(lane);
            this.handleLaneTap(lane);
        });

        this.canvas.addEventListener('mouseup', (e) => {
            const lane = this._xToLane(e.clientX);
            this.heldLanes.delete(lane);
            this.handleLaneRelease(lane);
        });

        // Keyboard
        const keyMap = { 'a': 0, 's': 1, 'd': 2, 'j': 3, 'k': 4 };
        document.addEventListener('keydown', (e) => {
            if (!this.isRunning || this.isPaused) return;
            if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) {
                this.tryActivateOverdrive();
                return;
            }
            if (e.key in keyMap && !e.repeat) {
                const lane = keyMap[e.key];
                this.heldLanes.add(lane);
                this.handleLaneTap(lane);
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key in keyMap) {
                const lane = keyMap[e.key];
                this.heldLanes.delete(lane);
                this.handleLaneRelease(lane);
            }
        });
    }

    _xToLane(clientX) {
        const rect = this.canvas.getBoundingClientRect();
        const relX = (clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(this.laneCount - 1, Math.floor(relX * this.laneCount)));
    }

    getScoreMultiplier() {
        if (this.combo >= 30) return 4;
        if (this.combo >= 20) return 3;
        if (this.combo >= 10) return 2;
        return 1;
    }

    getEffectiveMultiplier() {
        const base = this.getScoreMultiplier();
        return this.overdriveActive ? base * 2 : base;
    }

    tryActivateOverdrive() {
        if (!this.isRunning || this.isPaused || this.overdriveActive) return;
        if (this.overdriveMeter < 0.5) return;
        this.overdriveActive = true;
        this.overdriveActivations++;
        if (this.onOverdriveChange) {
            this.onOverdriveChange({ meter: this.overdriveMeter, active: this.overdriveActive });
        }
    }

    handleLaneTap(lane) {
        if (!this.isRunning || this.isPaused) return;
        // Use perceived time + calibration offset (same as render loop)
        const currentTime = this.audio.getPerceivedTime() + (this.timingOffset / 1000);

        // Find closest unhit note in this lane
        let bestNote = null;
        let bestDiff = Infinity;

        for (const note of this.notes) {
            if (note.hit || note.missed || note.lane !== lane) continue;
            // For hold notes that are already being held, skip
            if (note.holdActive) continue;
            const diff = Math.abs(note.time - currentTime);
            if (diff < bestDiff && diff <= this.windows.good) {
                bestDiff = diff;
                bestNote = note;
            }
        }

        if (bestNote) {
            let hitType;
            let baseScore;
            if (bestDiff <= this.windows.perfect) {
                hitType = 'perfect';
                baseScore = 300;
            } else if (bestDiff <= this.windows.great) {
                hitType = 'great';
                baseScore = 200;
            } else {
                hitType = 'good';
                baseScore = 100;
            }

            const mult = this.getEffectiveMultiplier();
            this.score += baseScore * mult;

            bestNote.hitType = hitType;
            bestNote.hitTime = performance.now();
            bestNote.ripple = { start: performance.now(), lane: lane, type: hitType };

            if (bestNote.type === 'hold' && bestNote.holdDuration > 0) {
                // Hold note: start holding, don't mark fully hit until completion.
                bestNote.holdActive = true;
                bestNote.holdStartTime = currentTime;
                bestNote.holdProgress = 0;
            } else {
                // Regular tap note
                bestNote.hit = true;
            }

            this.combo++;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.hits[hitType]++;

            if (bestNote.overdrive && !bestNote.overdriveAwarded) {
                bestNote.overdriveAwarded = true;
                this.overdriveMeter = Math.min(1, this.overdriveMeter + 0.07);
                if (this.onOverdriveChange) {
                    this.onOverdriveChange({ meter: this.overdriveMeter, active: this.overdriveActive });
                }
            }

            // No SFX beeps — the stem ducking IS the audio feedback
            if (this.onHit) this.onHit(hitType);
            if (this.onScoreChange) this.onScoreChange(Math.floor(this.score), this.combo);
            return;
        }

        // Overhit: tapping in/near timing windows with no valid note should break streak.
        const cooldownMs = 80;
        const nowMs = performance.now();
        if (nowMs - this.lastOverhitAt < cooldownMs) return;

        const nearAnyNote = this.notes.some((note) => {
            if (note.hit || note.missed || note.holdActive) return false;
            return Math.abs(note.time - currentTime) <= this.windows.good;
        });

        if (nearAnyNote) {
            this.lastOverhitAt = nowMs;
            this.combo = 0;
            this.hits.overhit++;
            this.hits.miss++;
            if (this.onHit) this.onHit('miss');
            if (this.onScoreChange) this.onScoreChange(Math.floor(this.score), this.combo);
        }
    }

    handleLaneRelease(lane) {
        if (!this.isRunning || this.isPaused) return;
        const currentTime = this.audio.getPerceivedTime() + (this.timingOffset / 1000);

        // Find any active hold note in this lane
        for (const note of this.notes) {
            if (!note.holdActive || note.lane !== lane) continue;
            // Complete the hold
            const holdEnd = note.time + note.holdDuration;
            const elapsed = currentTime - note.holdStartTime;
            note.holdProgress = Math.min(1, elapsed / note.holdDuration);

            // Award hold bonus based on how much was held and treat early release as miss.
            const holdBonus = Math.floor(200 * note.holdProgress) * this.getEffectiveMultiplier();
            this.score += holdBonus;

            note.holdActive = false;
            note.hit = note.holdProgress >= 0.8;
            if (!note.hit) {
                note.missed = true;
                this.hits.miss++;
            }
            note.hitTime = performance.now();

            if (note.holdProgress < 0.8) {
                // Released too early - break combo and treat as dropped sustain.
                this.combo = 0;
            }

            if (this.onScoreChange) this.onScoreChange(Math.floor(this.score), this.combo);
            break;
        }
    }

    start(song, notes, diffConfig) {
        this.song = song;
        this.bpm = song.bpm;
        this.songDuration = song.duration;
        this.diffConfig = diffConfig || null;

        // Apply lane count (always 5)
        this.laneCount = 5;

        // Apply difficulty timing window multiplier
        const tw = (diffConfig && diffConfig.timingWindow) || 1.0;
        this.windows = {
            perfect: 0.045 * tw,
            great: 0.09 * tw,
            good: 0.135 * tw,
        };

        this.notes = notes.map(n => ({
            ...n,
            hit: false,
            missed: false,
            hitTime: 0,
            hitType: null,
            ripple: null,
            holdActive: false,
            holdStartTime: 0,
            holdProgress: 0,
            overdriveAwarded: false,
        }));

        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.hits = { perfect: 0, great: 0, good: 0, miss: 0, overhit: 0 };
        this.lastOverhitAt = 0;
        this.overdriveMeter = 0;
        this.overdriveActive = false;
        this.overdriveActivations = 0;
        if (this.onOverdriveChange) {
            this.onOverdriveChange({ meter: this.overdriveMeter, active: this.overdriveActive });
        }

        // Precompute last note end time for early game-over when audio has dead tail
        this.lastNoteEndTime = 0;
        for (const n of this.notes) {
            const end = n.time + (n.holdDuration || 0);
            if (end > this.lastNoteEndTime) this.lastNoteEndTime = end;
        }

        this.isRunning = true;
        this.isPaused = false;

        this.resizeCanvas();
        this.lastFrame = performance.now();
        this.gameLoop();
    }

    pause() {
        this.isPaused = true;
        this.audio.pauseMusic();
        if (this.rafId) cancelAnimationFrame(this.rafId);
    }

    resume() {
        this.isPaused = false;
        Promise.resolve(this.audio.resumeMusic()).catch(() => {});
        this.lastFrame = performance.now();
        this.gameLoop();
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;
        this.audio.stopMusic();
        if (this.rafId) cancelAnimationFrame(this.rafId);
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
    }

    gameLoop() {
        if (!this.isRunning || this.isPaused) return;

        const now = performance.now();
        const dtSec = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
        this.lastFrame = now;

        // Use perceived time + user calibration offset for all gameplay
        const offsetSec = this.timingOffset / 1000;
        const currentTime = this.audio.getPerceivedTime() + offsetSec;
        const rawTime = this.audio.getCurrentTime();
        const duration = this.audio.getDuration() || this.songDuration;
        const progress = Math.min(1, rawTime / duration);

        if (this.overdriveActive) {
            this.overdriveMeter = Math.max(0, this.overdriveMeter - this.overdriveDrainPerSec * dtSec);
            if (this.overdriveMeter <= 0.001) {
                this.overdriveActive = false;
            }
            if (this.onOverdriveChange) {
                this.onOverdriveChange({ meter: this.overdriveMeter, active: this.overdriveActive });
            }
        }

        // Check for missed notes + update active holds
        for (const note of this.notes) {
            // Active hold notes: update progress, check for lane release
            if (note.holdActive) {
                const holdEnd = note.time + note.holdDuration;
                note.holdProgress = Math.min(1, (currentTime - note.holdStartTime) / note.holdDuration);

                // Check if lane is still held
                if (!this.heldLanes.has(note.lane)) {
                    // Player released - complete the hold
                    const holdBonus = Math.floor(200 * note.holdProgress) * this.getEffectiveMultiplier();
                    this.score += holdBonus;
                    note.holdActive = false;
                    note.hit = note.holdProgress >= 0.8;
                    if (!note.hit) {
                        note.missed = true;
                        this.hits.miss++;
                    }
                    note.hitTime = performance.now();
                    if (note.holdProgress < 0.8) this.combo = 0;
                    if (this.onScoreChange) this.onScoreChange(Math.floor(this.score), this.combo);
                    continue;
                }

                // Hold completed naturally
                if (currentTime >= holdEnd) {
                    this.score += 200 * this.getEffectiveMultiplier(); // full hold bonus
                    note.holdActive = false;
                    note.hit = true;
                    note.hitTime = performance.now();
                    if (this.onScoreChange) this.onScoreChange(Math.floor(this.score), this.combo);
                    continue;
                }
            }

            // Standard miss detection
            if (!note.hit && !note.missed && !note.holdActive &&
                currentTime > note.time + this.windows.good + 0.05) {
                note.missed = true;
                this.hits.miss++;
                this.combo = 0;
                if (this.onHit) this.onHit('miss');
                if (this.onScoreChange) this.onScoreChange(Math.floor(this.score), this.combo);
            }
        }

        // Check song end (use raw time for progress tracking)
        // Also end early if we're past all notes (handles dead tails in audio)
        const pastAllNotes = currentTime > this.lastNoteEndTime + 3.0;
        if (rawTime >= duration - 0.5 || progress >= 0.99 || pastAllNotes) {
            this.completeGame();
            return;
        }

        this.render(currentTime, now);
        this.singer.update(currentTime, this.bpm, false);
        this.singer.draw();

        this.rafId = requestAnimationFrame(() => this.gameLoop());
    }

    render(currentTime, now) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const laneWidth = w / this.laneCount;
        const hitY = h * this.hitLineY;

        // Travel time in seconds - how long a note is visible before reaching hit line
        const travelTime = Math.max(0.85, Math.min(2.25, 2.35 - (this.noteSpeed * 0.15)));

        // Clear
        ctx.fillStyle = this.overdriveActive ? '#0b0f1e' : '#0a0014';
        ctx.fillRect(0, 0, w, h);

        // Background grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let i = 1; i < this.laneCount; i++) {
            const x = i * laneWidth;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Lane glows at hit zone
        for (let i = 0; i < this.laneCount; i++) {
            const glow = ctx.createRadialGradient(
                (i + 0.5) * laneWidth, hitY, 5,
                (i + 0.5) * laneWidth, hitY, laneWidth * 0.6
            );
            glow.addColorStop(0, this.laneGlowColors[i] + '0.12)');
            glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow;
            ctx.fillRect(i * laneWidth, hitY - laneWidth, laneWidth, laneWidth * 2);
        }

        // Hit line
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, hitY);
        ctx.lineTo(w, hitY);
        ctx.stroke();

        // Hit zone indicators (target shapes)
        for (let i = 0; i < this.laneCount; i++) {
            const cx = (i + 0.5) * laneWidth;
            ctx.strokeStyle = this.laneColors[i] + '55';
            ctx.lineWidth = 2;
            this.drawShape(ctx, cx, hitY, 20, this.shapeTypes[i], false);
        }

        // Draw notes (hold bars first, then shapes on top)
        const noteSize = Math.min(28, laneWidth * 0.35);

        // === PASS 1: Draw hold note bars/rails ===
        for (const note of this.notes) {
            if (note.type !== 'hold' || !note.holdDuration) continue;
            if (note.hit && !note.holdActive) {
                // Completed hold - skip bar
                continue;
            }
            if (note.missed) continue;

            const headTimeDiff = note.time - currentTime;
            const tailTimeDiff = (note.time + note.holdDuration) - currentTime;

            // Visible range check
            if (headTimeDiff > travelTime + 0.5 && tailTimeDiff > travelTime + 0.5) continue;
            if (tailTimeDiff < -0.5) continue;

            const headProgress = 1 - (headTimeDiff / travelTime);
            const tailProgress = 1 - (tailTimeDiff / travelTime);

            let headY = headProgress * hitY;
            let tailY = tailProgress * hitY;

            // During active hold, clamp head to hit line
            if (note.holdActive) {
                headY = hitY;
            }

            // Clamp to visible area
            const drawHeadY = Math.min(headY, hitY + noteSize);
            const drawTailY = Math.max(tailY, -noteSize);

            if (drawHeadY <= drawTailY) continue;

            const cx = (note.lane + 0.5) * laneWidth;
            const barWidth = noteSize * 0.7;
            const color = this.laneColors[note.lane];

            // Draw the hold rail
            ctx.fillStyle = color;
            ctx.globalAlpha = note.holdActive ? 0.7 : 0.4;
            const rx = cx - barWidth / 2;
            const ry = drawTailY;
            const rw = barWidth;
            const rh = drawHeadY - drawTailY;

            // Rounded rectangle
            const radius = barWidth / 2;
            ctx.beginPath();
            ctx.moveTo(rx + radius, ry);
            ctx.lineTo(rx + rw - radius, ry);
            ctx.arc(rx + rw - radius, ry + radius, radius, -Math.PI / 2, 0);
            ctx.lineTo(rx + rw, ry + rh - radius);
            ctx.arc(rx + rw - radius, ry + rh - radius, radius, 0, Math.PI / 2);
            ctx.lineTo(rx + radius, ry + rh);
            ctx.arc(rx + radius, ry + rh - radius, radius, Math.PI / 2, Math.PI);
            ctx.lineTo(rx, ry + radius);
            ctx.arc(rx + radius, ry + radius, radius, Math.PI, -Math.PI / 2);
            ctx.closePath();
            ctx.fill();

            // Filled (completed) portion during active hold
            if (note.holdActive && note.holdProgress > 0) {
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = '#ffffff';
                const filledH = rh * note.holdProgress;
                ctx.fillRect(rx, ry + rh - filledH, rw, filledH);
            }

            ctx.globalAlpha = 1;

            // Tail cap (small shape at end of hold)
            if (drawTailY > 0) {
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.5;
                this.drawShape(ctx, cx, drawTailY, noteSize * 0.5, this.shapeTypes[note.lane], true);
                ctx.globalAlpha = 1;
            }
        }

        // === PASS 2: Draw chord connectors ===
        // Group notes by time (within 10ms = same chord)
        const notesByTime = new Map();
        for (const note of this.notes) {
            if (note.hit || note.missed) continue;
            const timeDiff = note.time - currentTime;
            if (timeDiff > travelTime + 0.5 || timeDiff < -0.5) continue;

            const timeKey = Math.round(note.time * 100); // group within 10ms
            if (!notesByTime.has(timeKey)) notesByTime.set(timeKey, []);
            notesByTime.get(timeKey).push(note);
        }

        for (const [, group] of notesByTime) {
            if (group.length < 2) continue;
            // Draw connecting bar between chord notes
            const timeDiff = group[0].time - currentTime;
            const progress = 1 - (timeDiff / travelTime);
            const chordY = progress * hitY;
            if (chordY < 0 || chordY > h) continue;

            const sortedLanes = group.map(n => n.lane).sort((a, b) => a - b);
            const leftX = (sortedLanes[0] + 0.5) * laneWidth;
            const rightX = (sortedLanes[sortedLanes.length - 1] + 0.5) * laneWidth;

            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(leftX, chordY);
            ctx.lineTo(rightX, chordY);
            ctx.stroke();
        }

        // === PASS 3: Draw note shapes ===
        for (const note of this.notes) {
            const timeDiff = note.time - currentTime;

            // Only render notes in visible range
            if (timeDiff > travelTime + 0.5 || timeDiff < -0.5) continue;

            const progress = 1 - (timeDiff / travelTime);
            let noteY = progress * hitY;

            // Active hold: head stays at hit line
            if (note.holdActive) noteY = hitY;

            if (note.hit && !note.holdActive) {
                // Hit animation - burst and fade
                const elapsed = now - note.hitTime;
                if (elapsed > 300) continue;
                const fadeProg = elapsed / 300;
                const scale = 1 + fadeProg * 1.5;
                const alpha = 1 - fadeProg;

                ctx.globalAlpha = alpha;
                ctx.fillStyle = this.laneColors[note.lane];
                const cx = (note.lane + 0.5) * laneWidth;
                this.drawShape(ctx, cx, hitY, noteSize * scale, this.shapeTypes[note.lane], true);
                ctx.globalAlpha = 1;
                continue;
            }

            if (note.missed) continue;

            // Draw the note shape
            const cx = (note.lane + 0.5) * laneWidth;

            // Growing glow as it approaches hit line
            if (progress > 0.5) {
                const glowIntensity = (progress - 0.5) * 2;
                const noteGlow = ctx.createRadialGradient(cx, noteY, noteSize * 0.5, cx, noteY, noteSize * 2);
                noteGlow.addColorStop(0, this.laneGlowColors[note.lane] + (glowIntensity * 0.3) + ')');
                noteGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = noteGlow;
                ctx.fillRect(cx - noteSize * 2, noteY - noteSize * 2, noteSize * 4, noteSize * 4);
            }

            const isHOPO = !!note.hopo;
            if (isHOPO) {
                ctx.strokeStyle = this.laneColors[note.lane];
                ctx.lineWidth = 4;
                this.drawShape(ctx, cx, noteY, noteSize, this.shapeTypes[note.lane], false);
            } else {
                ctx.fillStyle = this.laneColors[note.lane];
                this.drawShape(ctx, cx, noteY, noteSize, this.shapeTypes[note.lane], true);
            }

            if (note.overdrive) {
                ctx.strokeStyle = 'rgba(255,255,255,0.95)';
                ctx.lineWidth = 2;
                this.drawShape(ctx, cx, noteY, noteSize * 1.25, this.shapeTypes[note.lane], false);
            }

            // Bright center
            ctx.fillStyle = '#fff';
            ctx.globalAlpha = 0.4;
            this.drawShape(ctx, cx, noteY, noteSize * 0.4, this.shapeTypes[note.lane], true);
            ctx.globalAlpha = 1;
        }

        // Ripple effects
        for (const note of this.notes) {
            if (!note.ripple) continue;
            const elapsed = now - note.ripple.start;
            if (elapsed > 400) { note.ripple = null; continue; }
            const prog = elapsed / 400;
            const radius = 20 + prog * 50;
            const alpha = (1 - prog) * 0.5;
            const cx = (note.ripple.lane + 0.5) * laneWidth;

            ctx.strokeStyle = this.laneColors[note.ripple.lane];
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 3 * (1 - prog);
            ctx.beginPath();
            ctx.arc(cx, hitY, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Beat pulse effect on hit line
        const beatInterval = 60 / this.bpm;
        const beatPhase = (currentTime % beatInterval) / beatInterval;
        if (beatPhase < 0.15) {
            const pulseAlpha = (1 - beatPhase / 0.15) * 0.15;
            ctx.fillStyle = `rgba(255,255,255,${pulseAlpha})`;
            ctx.fillRect(0, hitY - 3, w, 6);
        }
    }

    drawShape(ctx, x, y, size, shape, fill) {
        ctx.beginPath();
        switch (shape) {
            case 'circle':
                ctx.arc(x, y, size, 0, Math.PI * 2);
                break;
            case 'diamond':
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size, y);
                ctx.lineTo(x, y + size);
                ctx.lineTo(x - size, y);
                ctx.closePath();
                break;
            case 'square':
                ctx.rect(x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6);
                break;
            case 'triangle':
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size, y + size * 0.7);
                ctx.lineTo(x - size, y + size * 0.7);
                ctx.closePath();
                break;
            case 'pentagon':
                for (let i = 0; i < 5; i++) {
                    const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
                    const px = x + size * Math.cos(angle);
                    const py = y + size * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                break;
        }
        if (fill) ctx.fill(); else ctx.stroke();
    }

    completeGame() {
        this.isRunning = false;
        this.audio.stopMusic();
        if (this.rafId) cancelAnimationFrame(this.rafId);

        const totalNotes = this.notes.length;
        const hitCount = this.hits.perfect + this.hits.great + this.hits.good;
        const accuracy = totalNotes > 0 ? hitCount / totalNotes : 0;

        let grade, stars;
        if (accuracy >= 0.95 && this.hits.miss === 0) {
            grade = 'S'; stars = 3;
        } else if (accuracy >= 0.9) {
            grade = 'A'; stars = 3;
        } else if (accuracy >= 0.8) {
            grade = 'B'; stars = 2;
        } else if (accuracy >= 0.6) {
            grade = 'C'; stars = 1;
        } else {
            grade = 'D'; stars = 0;
        }

        const results = {
            score: Math.floor(this.score),
            grade,
            stars,
            accuracy,
            perfect: this.hits.perfect,
            great: this.hits.great,
            good: this.hits.good,
            miss: this.hits.miss,
            maxCombo: this.maxCombo,
            totalNotes,
            overdriveActivations: this.overdriveActivations
        };

        if (this.onComplete) this.onComplete(results);
    }
}

window.GameEngine = GameEngine;
