/**
 * Main app - wires everything together.
 */
(function () {
    'use strict';

    // Systems
    const audio = new AudioEngine();
    const beatMaps = new BeatMapManager();
    const catalogue = new CatalogueManager();
    const screens = new ScreenManager();

    // Singer canvas
    const singerCanvas = document.getElementById('singer-canvas');
    const singer = new SingerRenderer(singerCanvas);

    // Game canvas
    const gameCanvas = document.getElementById('game-canvas');
    const game = new GameEngine(gameCanvas, audio, beatMaps, singer);

    // Current selection
    let selectedArtistId = null;
    let selectedSongId = null;
    let selectedDifficultyId = null;
    let selectedInstrument = 'mix';

    // Settings
    let settings = loadSettings();
    let calibrationState = null;

    // ===== LOADING =====
    window.addEventListener('load', () => {
        simulateLoading();
    });

    function simulateLoading() {
        const bar = document.getElementById('loading-bar');
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15 + 5;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                bar.style.width = '100%';
                setTimeout(() => {
                    screens.show('screen-menu');
                    updateMenuStats();
                }, 400);
            }
            bar.style.width = progress + '%';
        }, 120);
    }

    // ===== MENU =====
    function updateMenuStats() {
        document.getElementById('stat-stars').textContent = catalogue.getTotalStars();
        document.getElementById('stat-unlocked').textContent = catalogue.getTotalSongsUnlocked();
    }

    document.getElementById('btn-play').addEventListener('click', () => {
        audio.init();
        audio.resume();
        screens.show('screen-artists');
        renderArtistGrid();
    });

    document.getElementById('btn-catalogue').addEventListener('click', () => {
        screens.show('screen-catalogue');
        renderCatalogue();
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
        screens.show('screen-settings');
        applySettingsToUI();
    });

    document.getElementById('btn-open-calibration').addEventListener('click', () => {
        screens.show('screen-calibration');
        resetCalibrationUI();
    });

    document.getElementById('btn-back-calibration').addEventListener('click', () => {
        stopCalibration();
        screens.show('screen-settings');
        applySettingsToUI();
    });

    // ===== ARTIST SELECT =====
    document.getElementById('btn-back-artists').addEventListener('click', () => {
        screens.show('screen-menu');
        updateMenuStats();
    });

    function renderArtistGrid() {
        const grid = document.getElementById('artist-grid');
        document.getElementById('artist-stars').textContent = catalogue.getTotalStars();
        grid.innerHTML = '';

        for (const artist of catalogue.artists) {
            const unlocked = catalogue.isArtistUnlocked(artist.id);
            const songCount = catalogue.getSongsForArtist(artist.id).length;
            const card = document.createElement('div');
            card.className = 'artist-card' + (unlocked ? '' : ' locked');
            card.innerHTML = `
                <div class="artist-avatar" style="background: linear-gradient(135deg, ${artist.color}, ${artist.color}88);">
                    ${artist.emoji}
                </div>
                <div class="artist-name">${escapeHtml(artist.name)}</div>
                <div class="artist-songs-count">${songCount} songs</div>
                ${!unlocked ? `
                    <div class="artist-lock-overlay">
                        <div class="lock-icon">🔒</div>
                        <div class="lock-cost">★ ${artist.unlockCost} to unlock</div>
                    </div>` : ''}
            `;

            card.addEventListener('click', () => {
                if (unlocked) {
                    selectedArtistId = artist.id;
                    screens.show('screen-songs');
                    renderSongList(artist.id);
                }
            });

            grid.appendChild(card);
        }
    }

    // ===== SONG SELECT =====
    document.getElementById('btn-back-songs').addEventListener('click', () => {
        screens.show('screen-artists');
        renderArtistGrid();
    });

    function renderSongList(artistId) {
        const artist = catalogue.getArtist(artistId);
        const songs = catalogue.getSongsForArtist(artistId);

        document.getElementById('songs-artist-name').textContent = artist.name;
        document.getElementById('song-stars').textContent = catalogue.getTotalStars();

        const list = document.getElementById('song-list');
        list.innerHTML = '';

        for (const song of songs) {
            // Aggregate best stars across all difficulties
            let bestStars = 0;
            for (const diff of DIFFICULTIES) {
                const b = catalogue.getSongBest(song.id, diff.id);
                if (b && b.stars > bestStars) bestStars = b.stars;
            }

            const card = document.createElement('div');
            card.className = 'song-card';

            const minutes = Math.floor(song.duration / 60);
            const seconds = String(Math.floor(song.duration % 60)).padStart(2, '0');

            card.innerHTML = `
                <div class="song-info">
                    <div class="song-title">${escapeHtml(song.title)}</div>
                    <div class="song-duration">${minutes}:${seconds} • ${song.bpm} BPM</div>
                </div>
                <div class="song-best">
                    <div class="song-best-stars">${bestStars > 0 ? '★'.repeat(bestStars) + '☆'.repeat(3 - bestStars) : '☆☆☆'}</div>
                </div>
            `;

            card.addEventListener('click', () => {
                selectedSongId = song.id;
                screens.show('screen-difficulty');
                renderDifficultyList(song);
            });

            list.appendChild(card);
        }
    }

    // ===== DIFFICULTY SELECT =====
    document.getElementById('btn-back-difficulty').addEventListener('click', () => {
        screens.show('screen-songs');
        if (selectedArtistId) renderSongList(selectedArtistId);
    });

    function renderDifficultyList(song) {
        document.getElementById('diff-song-name').textContent = song.title;

        const list = document.getElementById('difficulty-list');
        list.innerHTML = '';

        for (const diff of DIFFICULTIES) {
            const best = catalogue.getSongBest(song.id, diff.id);
            const card = document.createElement('div');
            card.className = 'difficulty-card';
            card.style.borderColor = diff.color + '44';

            card.innerHTML = `
                <div class="difficulty-badge" style="background: linear-gradient(135deg, ${diff.color}, ${diff.color}aa);">
                    ${diff.name.slice(0, 3)}
                </div>
                <div class="difficulty-info">
                    <div class="difficulty-name" style="color: ${diff.color};">${diff.name}</div>
                    <div class="difficulty-desc">${diff.description}</div>
                </div>
                <div class="difficulty-stars">
                    <div class="song-best-stars">${best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '☆☆☆'}</div>
                    ${best ? `<div class="song-best-score">${best.score.toLocaleString()}</div>` : ''}
                </div>
            `;

            card.addEventListener('click', () => {
                selectedDifficultyId = diff.id;
                screens.show('screen-instrument');
                renderInstrumentList(song, diff);
            });

            list.appendChild(card);
        }
    }

    // ===== CATALOGUE (unlock screen) =====
    document.getElementById('btn-back-catalogue').addEventListener('click', () => {
        screens.show('screen-menu');
        updateMenuStats();
    });

    // ===== INSTRUMENT SELECT =====
    const INSTRUMENTS = [
        { id: 'vocals', name: 'Vocals',     emoji: '🎤', desc: 'Tap on words & vocal phrases' },
        { id: 'drums',  name: 'Drums',      emoji: '🥁', desc: 'Hit every drum beat' },
        { id: 'other',  name: 'Guitar/Keys', emoji: '🎸', desc: 'Follow guitar riffs & synths' },
        { id: 'bass',   name: 'Bass',       emoji: '🎵', desc: 'Groove with the bass line' },
        { id: 'mix',    name: 'Full Mix',   emoji: '🎶', desc: 'All instruments combined' },
    ];

    document.getElementById('btn-back-instrument').addEventListener('click', () => {
        screens.show('screen-difficulty');
        const song = catalogue.getSong(selectedSongId);
        if (song) renderDifficultyList(song);
    });

    function renderInstrumentList(song, diff) {
        document.getElementById('inst-song-name').textContent = 'PICK YOUR PART';

        const list = document.getElementById('instrument-list');
        list.innerHTML = '';

        for (const inst of INSTRUMENTS) {
            const card = document.createElement('div');
            card.className = 'difficulty-card instrument-card';
            card.innerHTML = `
                <div class="difficulty-badge instrument-badge">${inst.emoji}</div>
                <div class="difficulty-info">
                    <div class="difficulty-name">${inst.name}</div>
                    <div class="difficulty-desc">${inst.desc}</div>
                </div>
            `;

            card.addEventListener('click', () => {
                selectedInstrument = inst.id;
                startGame(song, diff);
            });

            list.appendChild(card);
        }
    }

    function renderCatalogue() {
        const list = document.getElementById('catalogue-list');
        document.getElementById('catalogue-stars').textContent = catalogue.getTotalStars();
        list.innerHTML = '';

        for (const artist of catalogue.artists) {
            const unlocked = catalogue.isArtistUnlocked(artist.id);
            const canUnlock = catalogue.canUnlockArtist(artist.id);

            const card = document.createElement('div');
            card.className = 'catalogue-card' + (unlocked ? ' unlocked' : '');

            card.innerHTML = `
                <div class="catalogue-avatar" style="background: linear-gradient(135deg, ${artist.color}, ${artist.color}88);">
                    ${artist.emoji}
                </div>
                <div class="catalogue-info">
                    <div class="catalogue-name">${escapeHtml(artist.name)}</div>
                    <div class="catalogue-desc">${catalogue.getSongsForArtist(artist.id).length} songs • ${escapeHtml(artist.description)}</div>
                </div>
                <div class="catalogue-status">
                    ${unlocked
                        ? '<div class="catalogue-unlocked-badge">✓ UNLOCKED</div>'
                        : `<div class="catalogue-cost">★ ${artist.unlockCost}</div>
                           ${canUnlock ? '<button class="btn-unlock">UNLOCK</button>' : '<div style="font-size:0.55rem;color:rgba(255,255,255,0.3);margin-top:4px;">Need more ★</div>'}`
                    }
                </div>
            `;

            // Unlock button handler
            const unlockBtn = card.querySelector('.btn-unlock');
            if (unlockBtn) {
                unlockBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (catalogue.unlockArtist(artist.id)) {
                        renderCatalogue(); // re-render
                    }
                });
            }

            list.appendChild(card);
        }
    }

    // ===== GAMEPLAY =====
    async function startGame(song, diff) {
        screens.show('screen-game');
        game.resizeCanvas();

        const instLabel = selectedInstrument || 'mix';
        let useStemsMode = false;

        // Show loading in HUD
        document.getElementById('hud-score').textContent = '0';
        document.getElementById('hud-combo').textContent = '';
        document.getElementById('hud-progress').style.width = '0%';
        document.getElementById('hud-overdrive').style.width = '0%';
        document.getElementById('btn-overdrive').classList.remove('ready', 'active');
        document.getElementById('hud-notes').textContent = 'Loading...';

        // Derive stem directory from audio filename
        const filename = song.audioFile.replace(/^.*\//, '').replace(/\.wav$/i, '');

        // Load stems for instrument-specific mode
        if (instLabel !== 'mix' && audio.canUseStems()) {
            try {
                audio.setupStemGains();
                await audio.loadStems(`stems/${filename}`);
                useStemsMode = true;
                console.log(`[RecordTap] Stems loaded for "${filename}"`);
            } catch (e) {
                console.warn('[RecordTap] Stem loading failed, using mix fallback:', e);
            }
        } else if (instLabel !== 'mix') {
            console.log('[RecordTap] iOS-safe mode: using mix playback instead of stems.');
        }

        // Load mix audio (fallback + duration reference)
        let audioBuffer;
        if (song.audioFile) {
            if (audio.isIOS && !useStemsMode) {
                // iOS reliability path: stream with HTMLAudioElement instead of full decode.
                audioBuffer = song.audioFile;
            } else {
                audioBuffer = await audio.loadAudio(song.audioFile);
            }
        } else {
            audioBuffer = audio.generateDemoTrack(song.duration, song.bpm);
        }

        // Load prebuilt chart (offline-generated); fallback to legacy analysis path
        let notes = null;
        if (song.audioFile) {
            const chart = await beatMaps.loadChart(song.audioFile);
            if (chart) {
                notes = beatMaps.getChartNotes(song.id, chart, diff.id, instLabel);
            } else {
                const analysis = await beatMaps.loadAnalysis(song.audioFile);
                if (analysis) {
                    notes = beatMaps.generateFromAnalysis(song.id, analysis, diff, instLabel);
                } else {
                    notes = beatMaps.generateFromBPM(song.id, song.bpm, song.duration, diff);
                }
                console.warn('[RecordTap] Missing prebuilt chart, used legacy generation path.');
            }
        } else {
            notes = beatMaps.generateFromBPM(song.id, song.bpm, song.duration, diff);
        }
        console.log(`[RecordTap v23] ${instLabel} / ${diff.id}: ${notes.length} notes | stems: ${useStemsMode}`);

        // Set singer color from artist
        const artist = catalogue.getArtist(song.artistId);
        if (artist) singer.setColor(artist.color);

        // Apply settings
        game.noteSpeed = settings.noteSpeed;
        game.timingOffset = settings.timingOffset;
        audio.setMusicVolume(settings.musicVolume / 100);
        audio.setSfxVolume(settings.sfxVolume / 100);

        // Set up callbacks
        game.onScoreChange = (score, combo) => {
            document.getElementById('hud-score').textContent = score.toLocaleString();
            const comboEl = document.getElementById('hud-combo');
            if (combo >= 5) {
                comboEl.textContent = combo + 'x COMBO';
            } else {
                comboEl.textContent = '';
            }
        };

        game.onOverdriveChange = ({ meter, active }) => {
            document.getElementById('hud-overdrive').style.width = `${Math.round(meter * 100)}%`;
            const odBtn = document.getElementById('btn-overdrive');
            odBtn.classList.toggle('active', active);
            odBtn.classList.toggle('ready', !active && meter >= 0.5);
        };

        game.onHit = (type) => {
            showHitFeedback(type);
            if (type === 'miss') {
                // Duck the player's instrument stem — missing feels impactful
                if (useStemsMode) audio.duckStem(instLabel);
            } else {
                // Restore stem on any successful hit
                if (useStemsMode) audio.restoreStem(instLabel);
                singer.update(audio.getCurrentTime(), song.bpm, true);
            }
        };

        game.onComplete = (results) => {
            showResults(results);
        };

        // Update progress bar
        const progressLoop = setInterval(() => {
            if (!game.isRunning) {
                clearInterval(progressLoop);
                return;
            }
            const progress = audio.getCurrentTime() / (audio.getDuration() || song.duration);
            document.getElementById('hud-progress').style.width = Math.min(100, progress * 100) + '%';
        }, 100);

        // Update HUD
        const modeLabel = useStemsMode ? 'STEM' : 'MIX';
        document.getElementById('hud-notes').textContent = `v23 | ${instLabel} [${modeLabel}] | ${notes.length} notes`;

        // Start playback — stems for instrument mode, mix for full-mix mode
        const unlocked = await audio.resume();
        if (!unlocked) {
            throw new Error('Audio context is blocked. Tap screen and retry.');
        }

        if (useStemsMode) {
            await audio.playStems();
        } else {
            await audio.playMusic(audioBuffer);
        }
        requestWakeLock();
        game.start(song, notes, diff);
    }

    document.getElementById('btn-overdrive').addEventListener('click', () => {
        game.tryActivateOverdrive();
    });

    function showHitFeedback(type) {
        const el = document.getElementById('hit-feedback');
        el.classList.remove('show', 'hit-perfect', 'hit-great', 'hit-good', 'hit-miss');

        const labels = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
        el.textContent = labels[type];
        el.classList.add('hit-' + type);

        // Force reflow for animation restart
        void el.offsetWidth;
        el.classList.add('show');
    }

    // ===== PAUSE =====
    document.getElementById('btn-pause').addEventListener('click', () => {
        game.pause();
        screens.showOverlay('screen-pause');
    });

    document.getElementById('btn-resume').addEventListener('click', () => {
        screens.hideOverlay('screen-pause');
        game.resume();
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
        screens.hideOverlay('screen-pause');
        game.stop();
        const song = catalogue.getSong(selectedSongId);
        const diff = catalogue.getDifficulty(selectedDifficultyId);
        if (song && diff) startGame(song, diff);
    });

    document.getElementById('btn-quit').addEventListener('click', () => {
        screens.hideOverlay('screen-pause');
        game.stop();
        screens.show('screen-difficulty');
        const song = catalogue.getSong(selectedSongId);
        if (song) renderDifficultyList(song);
    });

    // ===== RESULTS =====
    function showResults(results) {
        // Save progress
        const newStars = catalogue.recordResult(selectedSongId, selectedDifficultyId, results.score, results.stars, results.grade);

        screens.show('screen-results');

        document.getElementById('results-grade').textContent = results.grade;
        document.getElementById('results-stars').textContent =
            '★'.repeat(results.stars) + '☆'.repeat(3 - results.stars);
        document.getElementById('result-score').textContent = results.score.toLocaleString();
        document.getElementById('result-perfect').textContent = results.perfect;
        document.getElementById('result-great').textContent = results.great;
        document.getElementById('result-good').textContent = results.good;
        document.getElementById('result-miss').textContent = results.miss;
        document.getElementById('result-combo').textContent = results.maxCombo;

        const unlockEl = document.getElementById('results-unlock');
        if (newStars > 0) {
            unlockEl.style.display = 'block';
            document.getElementById('unlock-earned').textContent = newStars;
        } else {
            unlockEl.style.display = 'none';
        }
    }

    document.getElementById('btn-retry').addEventListener('click', () => {
        const song = catalogue.getSong(selectedSongId);
        const diff = catalogue.getDifficulty(selectedDifficultyId);
        if (song && diff) startGame(song, diff);
    });

    document.getElementById('btn-results-back').addEventListener('click', () => {
        screens.show('screen-difficulty');
        const song = catalogue.getSong(selectedSongId);
        if (song) renderDifficultyList(song);
    });

    // ===== SETTINGS =====
    document.getElementById('btn-back-settings').addEventListener('click', () => {
        screens.show('screen-menu');
        updateMenuStats();
    });

    function loadSettings() {
        try {
            const raw = localStorage.getItem('recordtap_settings');
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return { musicVolume: 80, sfxVolume: 80, noteSpeed: 5, timingOffset: 0 };
    }

    function saveSettings() {
        localStorage.setItem('recordtap_settings', JSON.stringify(settings));
    }

    function applySettingsToUI() {
        document.getElementById('setting-music').value = settings.musicVolume;
        document.getElementById('setting-sfx').value = settings.sfxVolume;
        document.getElementById('setting-speed').value = settings.noteSpeed;
        document.getElementById('setting-offset').value = settings.timingOffset;
        document.getElementById('offset-value').textContent = settings.timingOffset;
    }

    document.getElementById('setting-music').addEventListener('input', (e) => {
        settings.musicVolume = parseInt(e.target.value);
        saveSettings();
    });

    document.getElementById('setting-sfx').addEventListener('input', (e) => {
        settings.sfxVolume = parseInt(e.target.value);
        saveSettings();
    });

    document.getElementById('setting-speed').addEventListener('input', (e) => {
        settings.noteSpeed = parseInt(e.target.value);
        saveSettings();
    });

    document.getElementById('setting-offset').addEventListener('input', (e) => {
        settings.timingOffset = parseInt(e.target.value);
        document.getElementById('offset-value').textContent = e.target.value;
        saveSettings();
    });

    document.getElementById('btn-reset-progress').addEventListener('click', () => {
        if (confirm('Reset all progress? This cannot be undone.')) {
            catalogue.resetProgress();
            updateMenuStats();
        }
    });

    // ===== CALIBRATION =====
    document.getElementById('btn-calibration-start').addEventListener('click', () => {
        startCalibration();
    });

    document.getElementById('btn-calibration-tap').addEventListener('click', () => {
        registerCalibrationTap(performance.now());
    });

    document.getElementById('btn-calibration-apply').addEventListener('click', () => {
        if (!calibrationState || calibrationState.resultMs == null) return;
        settings.timingOffset = Math.max(-200, Math.min(200, Math.round(calibrationState.resultMs)));
        saveSettings();
        applySettingsToUI();
        const readout = document.getElementById('calibration-readout');
        readout.textContent = `Applied offset: ${settings.timingOffset} ms`;
    });

    function resetCalibrationUI() {
        document.getElementById('calibration-readout').textContent = `Offset: ${settings.timingOffset} ms`;
        document.getElementById('calibration-instructions').textContent = 'Press START, then tap the pad in time with the click for 8 beats.';
        document.getElementById('btn-calibration-apply').disabled = true;
        document.getElementById('calibration-pulse').classList.remove('pulse');
    }

    function startCalibration() {
        audio.init();
        audio.resume();
        stopCalibration();

        calibrationState = {
            bpm: 120,
            beatMs: 500,
            beatCount: 0,
            startAt: performance.now() + 600,
            taps: [],
            intervalId: null,
            pulseId: null,
            resultMs: null,
        };

        const instructions = document.getElementById('calibration-instructions');
        instructions.textContent = 'Listen for click, tap with it. Target: 8 accurate taps.';

        calibrationState.intervalId = setInterval(() => {
            if (!calibrationState) return;
            const now = performance.now();
            const expected = calibrationState.startAt + calibrationState.beatCount * calibrationState.beatMs;
            if (now >= expected) {
                calibrationState.beatCount++;
                audio.playSfx('perfect');
                const pulse = document.getElementById('calibration-pulse');
                pulse.classList.remove('pulse');
                void pulse.offsetWidth;
                pulse.classList.add('pulse');

                if (calibrationState.beatCount >= 16) {
                    finishCalibration();
                }
            }
        }, 20);
    }

    function registerCalibrationTap(tapMs) {
        if (!calibrationState) return;
        const beatMs = calibrationState.beatMs;
        const idx = Math.round((tapMs - calibrationState.startAt) / beatMs);
        if (idx < 0 || idx > 16) return;
        const expected = calibrationState.startAt + idx * beatMs;
        const delta = tapMs - expected;
        if (Math.abs(delta) > 240) return;

        calibrationState.taps.push(delta);
        const readout = document.getElementById('calibration-readout');
        readout.textContent = `Captured taps: ${calibrationState.taps.length}/8`;

        if (calibrationState.taps.length >= 8) {
            finishCalibration();
        }
    }

    function finishCalibration() {
        if (!calibrationState) return;
        if (calibrationState.intervalId) clearInterval(calibrationState.intervalId);

        const taps = calibrationState.taps;
        if (taps.length === 0) {
            document.getElementById('calibration-readout').textContent = 'No taps captured. Try again.';
            return;
        }

        const sorted = [...taps].sort((a, b) => a - b);
        const core = sorted.slice(Math.floor(sorted.length * 0.15), Math.ceil(sorted.length * 0.85));
        const avg = core.reduce((sum, v) => sum + v, 0) / Math.max(core.length, 1);

        calibrationState.resultMs = avg;
        document.getElementById('calibration-readout').textContent = `Suggested offset: ${Math.round(avg)} ms`;
        document.getElementById('calibration-instructions').textContent = 'Apply the suggestion or run again for another sample.';
        document.getElementById('btn-calibration-apply').disabled = false;
    }

    function stopCalibration() {
        if (!calibrationState) return;
        if (calibrationState.intervalId) clearInterval(calibrationState.intervalId);
        calibrationState = null;
    }

    // ===== WINDOW RESIZE =====
    window.addEventListener('resize', () => {
        if (game.isRunning) {
            game.resizeCanvas();
        }
    });

    // ===== UTILITY =====
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Prevent pull-to-refresh on mobile
    document.body.addEventListener('touchmove', (e) => {
        if (game.isRunning) e.preventDefault();
    }, { passive: false });

    // Wake lock to keep screen on during gameplay
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
            }
        } catch(e) { /* not supported or denied */ }
    }

    // Visibility change - pause game when app goes to background
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && game.isRunning && !game.isPaused) {
            game.pause();
            screens.showOverlay('screen-pause');
        }
    });

})();
