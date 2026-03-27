/**
 * Audio engine - handles music playback and SFX using Web Audio API
 */
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.musicGain = null;
        this.sfxGain = null;
        this.currentSource = null;
        this.currentBuffer = null;
        this.startTime = 0;
        this.pauseOffset = 0;
        this.isPlaying = false;
        this.audioBufferCache = {};

        // Stem playback (multi-track)
        this.stemGains = {};
        this.stemSources = {};
        this.stemBuffers = {};
        this.usingStems = false;

        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.hasInstalledUnlockListeners = false;

        // iOS fallback path: stream with HTMLAudioElement instead of full WebAudio decode.
        this.htmlAudio = null;
        this.htmlAudioUrl = null;
        this.htmlVolume = 1;
    }

    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.musicGain.connect(this.ctx.destination);
        this.sfxGain.connect(this.ctx.destination);
        this.installUnlockListeners();
    }

    installUnlockListeners() {
        if (this.hasInstalledUnlockListeners) return;
        this.hasInstalledUnlockListeners = true;

        const unlock = async () => {
            await this.ensureRunning();
            document.removeEventListener('touchstart', unlock, true);
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
            document.removeEventListener('click', unlock, true);
        };

        document.addEventListener('touchstart', unlock, true);
        document.addEventListener('pointerdown', unlock, true);
        document.addEventListener('keydown', unlock, true);
        document.addEventListener('click', unlock, true);
    }

    async ensureRunning() {
        if (!this.ctx) return false;
        if (this.ctx.state === 'running') return true;

        try {
            await this.ctx.resume();
        } catch (e) {
            return false;
        }

        // iOS can report suspended briefly after resume request.
        if (this.ctx.state !== 'running') {
            await new Promise((resolve) => setTimeout(resolve, 30));
            try {
                await this.ctx.resume();
            } catch (e) {
                return false;
            }
        }
        return this.ctx.state === 'running';
    }

    async resume() {
        return this.ensureRunning();
    }

    canUseStems() {
        // iOS Safari is less reliable with multi-stem decode/playback on large WAV sets.
        return !this.isIOS;
    }

    setMusicVolume(v) {
        this.htmlVolume = v;
        if (this.musicGain) this.musicGain.gain.value = v;
        if (this.htmlAudio) this.htmlAudio.volume = v;
    }

    setSfxVolume(v) {
        if (this.sfxGain) this.sfxGain.gain.value = v;
    }

    /** Set up per-stem GainNodes (call once before playStems) */
    setupStemGains() {
        const stemNames = ['vocals', 'drums', 'bass', 'other'];
        this.stemGains = {};
        for (const name of stemNames) {
            const gain = this.ctx.createGain();
            gain.connect(this.musicGain);
            this.stemGains[name] = gain;
        }
    }

    /** Load all 4 stems for a song directory (parallel fetch) */
    async loadStems(stemDir) {
        const stemNames = ['vocals', 'drums', 'bass', 'other'];
        this.stemBuffers = {};
        const loads = stemNames.map(async name => {
            try {
                const url = `${stemDir}/${name}.wav`;
                this.stemBuffers[name] = await this.loadAudio(url);
            } catch (e) {
                console.warn(`[Audio] Failed to load stem ${name}:`, e);
            }
        });
        await Promise.all(loads);
        if (Object.keys(this.stemBuffers).length < 2) {
            throw new Error('Not enough stems loaded');
        }
    }

    /** Play all loaded stems synchronised from the beginning */
    async playStems() {
        const ready = await this.ensureRunning();
        if (!ready) throw new Error('Audio context is not running');
        this.stopMusic();
        this.stemSources = {};
        for (const name of Object.keys(this.stemBuffers)) {
            const src = this.ctx.createBufferSource();
            src.buffer = this.stemBuffers[name];
            src.connect(this.stemGains[name]);
            src.start(0, 0);
            this.stemSources[name] = src;
        }
        this.startTime = this.ctx.currentTime;
        this.isPlaying = true;
        this.usingStems = true;
        this.currentBuffer = Object.values(this.stemBuffers)[0] || null;
    }

    /** Fade a stem down (on miss — makes the player hear their part drop out) */
    duckStem(stemName) {
        const gain = this.stemGains[stemName];
        if (!gain) return;
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.setTargetAtTime(0.18, now, 0.05);
    }

    /** Fade a stem back up (on hit — player hears their part again) */
    restoreStem(stemName) {
        const gain = this.stemGains[stemName];
        if (!gain) return;
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.setTargetAtTime(1.0, now, 0.04);
    }

    async loadAudio(url) {
        if (this.audioBufferCache[url]) return this.audioBufferCache[url];
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        this.audioBufferCache[url] = audioBuffer;
        return audioBuffer;
    }

    async playMusic(bufferOrUrl) {
        // On iOS, prefer HTMLAudioElement stream playback for reliability.
        if (this.isIOS && typeof bufferOrUrl === 'string') {
            this.stopMusic();

            if (!this.htmlAudio || this.htmlAudioUrl !== bufferOrUrl) {
                const el = new Audio(bufferOrUrl);
                el.preload = 'auto';
                el.playsInline = true;
                el.setAttribute('playsinline', '');
                el.crossOrigin = 'anonymous';
                this.htmlAudio = el;
                this.htmlAudioUrl = bufferOrUrl;
            }

            this.htmlAudio.currentTime = this.pauseOffset || 0;
            this.htmlAudio.volume = this.htmlVolume;
            await this.htmlAudio.play();
            this.isPlaying = true;
            return;
        }

        const ready = await this.ensureRunning();
        if (!ready) throw new Error('Audio context is not running');
        this.stopMusic();
        this.currentBuffer = bufferOrUrl;
        this.currentSource = this.ctx.createBufferSource();
        this.currentSource.buffer = bufferOrUrl;
        this.currentSource.connect(this.musicGain);
        this.currentSource.start(0, this.pauseOffset);
        this.startTime = this.ctx.currentTime - this.pauseOffset;
        this.isPlaying = true;
    }

    stopMusic() {
        // Stop stem sources
        for (const name of Object.keys(this.stemSources)) {
            try { this.stemSources[name].stop(); } catch (e) {}
        }
        this.stemSources = {};
        // Reset stem gains to full
        for (const name of Object.keys(this.stemGains)) {
            this.stemGains[name].gain.cancelScheduledValues(0);
            this.stemGains[name].gain.value = 1.0;
        }
        // Stop single source
        if (this.currentSource) {
            try { this.currentSource.stop(); } catch (e) {}
            this.currentSource = null;
        }
        // Stop HTML audio fallback
        if (this.htmlAudio) {
            try { this.htmlAudio.pause(); } catch (e) {}
            this.htmlAudio.currentTime = 0;
        }
        this.isPlaying = false;
        this.usingStems = false;
        this.pauseOffset = 0;
    }

    pauseMusic() {
        if (!this.isPlaying) return;

        if (this.htmlAudio && !this.usingStems && !this.currentSource) {
            this.pauseOffset = this.htmlAudio.currentTime || 0;
            this.htmlAudio.pause();
            this.isPlaying = false;
            return;
        }

        this.pauseOffset = this.ctx.currentTime - this.startTime;
        // Stop stem sources (preserve gain states for resume)
        for (const name of Object.keys(this.stemSources)) {
            try { this.stemSources[name].stop(); } catch (e) {}
        }
        this.stemSources = {};
        // Stop single source
        if (this.currentSource) {
            try { this.currentSource.stop(); } catch (e) {}
            this.currentSource = null;
        }
        this.isPlaying = false;
    }

    async resumeMusic() {
        if (this.isPlaying) return;
        const offset = this.pauseOffset;

        if (this.htmlAudio && !this.usingStems && !this.currentBuffer) {
            this.htmlAudio.currentTime = offset;
            this.htmlAudio.volume = this.htmlVolume;
            await this.htmlAudio.play();
            this.isPlaying = true;
            return;
        }

        if (this.usingStems && Object.keys(this.stemBuffers).length > 0) {
            // Recreate stem sources at saved offset (gain states preserved)
            this.stemSources = {};
            for (const name of Object.keys(this.stemBuffers)) {
                const src = this.ctx.createBufferSource();
                src.buffer = this.stemBuffers[name];
                src.connect(this.stemGains[name]);
                src.start(0, offset);
                this.stemSources[name] = src;
            }
            this.startTime = this.ctx.currentTime - offset;
            this.isPlaying = true;
        } else if (this.currentBuffer) {
            this.currentSource = this.ctx.createBufferSource();
            this.currentSource.buffer = this.currentBuffer;
            this.currentSource.connect(this.musicGain);
            this.currentSource.start(0, offset);
            this.startTime = this.ctx.currentTime - offset;
            this.isPlaying = true;
        }
    }

    getCurrentTime() {
        if (this.htmlAudio && !this.usingStems && !this.currentSource) {
            if (!this.isPlaying) return this.pauseOffset;
            return this.htmlAudio.currentTime || 0;
        }
        if (!this.isPlaying) return this.pauseOffset;
        return this.ctx.currentTime - this.startTime;
    }

    /**
     * Returns the estimated audio output latency in seconds.
     * This is the delay between audio processing and when sound
     * actually reaches the speakers/headphones.
     */
    getOutputLatency() {
        if (!this.ctx) return 0;
        // Modern browsers expose outputLatency; baseLatency is the minimum
        const output = this.ctx.outputLatency || 0;
        const base = this.ctx.baseLatency || 0;
        // Use outputLatency if available, otherwise fall back to baseLatency.
        // Do NOT add a fallback constant — the user's calibration offset
        // handles device-specific tuning.
        if (output > 0) return output;
        if (base > 0) return base;
        return 0;
    }

    /**
     * Returns the playback time adjusted for output latency.
     * This represents what the user is actually HEARING right now.
     */
    getPerceivedTime() {
        return Math.max(0, this.getCurrentTime() - this.getOutputLatency());
    }

    getDuration() {
        if (this.htmlAudio && !this.usingStems && !this.currentBuffer) {
            return Number.isFinite(this.htmlAudio.duration) ? this.htmlAudio.duration : 0;
        }
        return this.currentBuffer ? this.currentBuffer.duration : 0;
    }

    playSfx(type) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.sfxGain);

        switch (type) {
            case 'perfect':
                osc.frequency.value = 880;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
                osc.start(); osc.stop(this.ctx.currentTime + 0.1);
                break;
            case 'great':
                osc.frequency.value = 660;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
                osc.start(); osc.stop(this.ctx.currentTime + 0.08);
                break;
            case 'good':
                osc.frequency.value = 440;
                osc.type = 'triangle';
                gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
                osc.start(); osc.stop(this.ctx.currentTime + 0.06);
                break;
            case 'miss':
                osc.frequency.value = 150;
                osc.type = 'sawtooth';
                gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
                osc.start(); osc.stop(this.ctx.currentTime + 0.15);
                break;
        }
    }

    /**
     * Generate a synthesized demo song (used when no real audio file is available).
     * Returns an AudioBuffer with a simple beat pattern.
     */
    generateDemoTrack(duration, bpm) {
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(2, length, sampleRate);
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);

        const beatInterval = 60 / bpm;

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            let sample = 0;

            // Bass drum on every beat
            const beatPhase = t % beatInterval;
            if (beatPhase < 0.08) {
                const env = 1 - beatPhase / 0.08;
                sample += Math.sin(2 * Math.PI * (80 - 40 * beatPhase / 0.08) * t) * env * 0.4;
            }

            // Hi-hat on off-beats
            const halfBeat = beatInterval / 2;
            const halfPhase = t % halfBeat;
            if (halfPhase < 0.02) {
                const env = 1 - halfPhase / 0.02;
                sample += (Math.random() * 2 - 1) * env * 0.15;
            }

            // Simple synth melody
            const bar = t % (beatInterval * 4);
            const noteFreqs = [261.63, 329.63, 392.00, 349.23]; // C E G F
            const noteIndex = Math.floor(bar / beatInterval);
            const notePhase = bar % beatInterval;
            if (notePhase < beatInterval * 0.8) {
                const env = Math.max(0, 1 - notePhase / (beatInterval * 0.8));
                sample += Math.sin(2 * Math.PI * noteFreqs[noteIndex] * t) * env * 0.12;
                sample += Math.sin(2 * Math.PI * noteFreqs[noteIndex] * 2 * t) * env * 0.05;
            }

            // Clamp
            sample = Math.max(-1, Math.min(1, sample));
            left[i] = sample;
            right[i] = sample;
        }

        return buffer;
    }
}

window.AudioEngine = AudioEngine;
