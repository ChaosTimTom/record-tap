"""
Stem-separated beat analysis using Demucs + librosa.

1. Demucs AI separates each song into 4 stems: vocals, drums, bass, other
2. Per-stem onset detection with DURATION (for hold notes) and strength
3. Vocal-specific analysis: detects word/phrase boundaries with durations
4. Outputs JSON with duration-aware note data per instrument

The game uses durations for hold notes and simultaneous strong onsets
for chord (multi-button) presses, like Guitar Hero / Rock Band.
"""

import argparse
import json
import os
import sys
import numpy as np
import librosa
import soundfile as sf
import torch
from scipy.signal import find_peaks
from scipy.ndimage import uniform_filter1d

ROOT = os.path.dirname(os.path.abspath(__file__))
SONGS_DIR = os.path.join(ROOT, "songs", "downs-east")
STEMS_DIR = os.path.join(ROOT, "stems")
STEMS = ["vocals", "drums", "bass", "other"]
SR = 22050
HOP = 512


def separate_song(wav_path, song_name):
    """Run Demucs 4-stem separation via Python API, save with soundfile."""
    out_dir = os.path.join(STEMS_DIR, song_name)
    if all(os.path.exists(os.path.join(out_dir, f"{s}.wav")) for s in STEMS):
        print(f"  Stems already exist, skipping separation")
        return True

    print(f"  Running Demucs AI separation (in-process)...")
    try:
        from demucs.pretrained import get_model
        from demucs.apply import apply_model

        model = get_model("htdemucs")
        model.eval()

        # Load audio with soundfile (avoids broken torchaudio/torchcodec on Windows)
        audio_data, sr = sf.read(wav_path, dtype='float32')
        if audio_data.ndim == 1:
            audio_data = np.stack([audio_data, audio_data])  # mono -> stereo
        else:
            audio_data = audio_data.T  # (samples, channels) -> (channels, samples)
        waveform = torch.from_numpy(audio_data)

        # Resample to model's sample rate if needed
        if sr != model.samplerate:
            import torchaudio.functional as F
            waveform = F.resample(waveform, sr, model.samplerate)
            sr = model.samplerate

        # Add batch dimension: (channels, samples) -> (1, channels, samples)
        ref = waveform.mean(0)
        waveform = (waveform - ref.mean()) / ref.std()
        sources = apply_model(model, waveform[None], device="cpu")[0]
        sources = sources * ref.std() + ref.mean()

        os.makedirs(out_dir, exist_ok=True)
        # model.sources gives stem names in order
        for i, stem_name in enumerate(model.sources):
            if stem_name in STEMS:
                stem_audio = sources[i].detach().cpu().numpy()
                dst = os.path.join(out_dir, f"{stem_name}.wav")
                sf.write(dst, stem_audio.T, sr)

        return all(os.path.exists(os.path.join(out_dir, f"{s}.wav")) for s in STEMS)
    except Exception as e:
        print(f"  ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def analyze_stem(wav_path, is_percussion=False, height_pct=80, prom_pct=55):
    """Onset detection with DURATION measurement for each note.
    
    Returns list of {time, strength, duration} where duration is how long
    the energy sustains after the onset (used for hold notes in-game).
    Percussion (drums) always gets duration=0 since drum hits are instant.
    
    height_pct / prom_pct: percentile thresholds for peak detection.
    Lower values = more sensitive (more onsets detected).
    Vocals should use ~35/25 to capture every syllable.
    """
    try:
        y, sr = librosa.load(wav_path, sr=SR, mono=True)
    except Exception as e:
        print(f"    Could not load {wav_path}: {e}")
        return []

    # Onset-strength envelope (spectral flux)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)

    if len(onset_env) == 0 or onset_env.max() == 0:
        return []

    # ── Peak detection with scipy ──
    min_dist = int(0.10 * sr / HOP)
    height_thr = float(np.percentile(onset_env, height_pct))
    prom_thr = float(np.percentile(onset_env, prom_pct))

    peaks, props = find_peaks(
        onset_env,
        height=height_thr,
        distance=min_dist,
        prominence=prom_thr,
    )

    if len(peaks) == 0:
        return []

    times = librosa.frames_to_time(peaks, sr=sr, hop_length=HOP)
    heights = props["peak_heights"]
    mx = float(heights.max()) if heights.max() > 0 else 1.0
    strengths = heights / mx

    # ── Duration measurement ──
    # For non-percussion: trace energy forward from each onset to find
    # how long the note sustains (when envelope drops below 30% of peak).
    # This creates hold notes for sustained vocals/guitar/bass.
    durations = []
    if is_percussion:
        durations = [0.0] * len(peaks)
    else:
        # RMS energy envelope for duration tracking (smoother than onset env)
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0]
        rms_smooth = uniform_filter1d(rms, size=5)

        for peak_idx, peak_frame in enumerate(peaks):
            peak_energy = rms_smooth[peak_frame] if peak_frame < len(rms_smooth) else 0
            if peak_energy <= 0:
                durations.append(0.0)
                continue

            # Find where energy drops below 30% of this onset's energy
            threshold = peak_energy * 0.30
            end_frame = peak_frame
            for f in range(peak_frame + 1, min(len(rms_smooth), peak_frame + int(5.0 * sr / HOP))):
                if rms_smooth[f] < threshold:
                    break
                end_frame = f

            dur = librosa.frames_to_time(end_frame - peak_frame, sr=sr, hop_length=HOP)
            # Only keep meaningful durations (>150ms = holdable in-game)
            dur = float(dur) if dur > 0.15 else 0.0
            # Cap at 5 seconds
            dur = min(dur, 5.0)
            durations.append(round(dur, 3))

    return [{"time": round(float(t), 4), "strength": round(float(s), 4), "duration": round(float(d), 3)}
            for t, s, d in zip(times, strengths, durations)]


def analyze_vocal_phrases(wav_path):
    """Vocal-specific analysis: detect word/phrase boundaries with durations.
    
    Uses energy-based segmentation to find continuous vocal activity regions.
    Each region = one word or phrase with a start time and duration.
    This maps directly to hold notes for vocals in the game.
    
    Returns list of {time, strength, duration} where each entry is a vocal phrase.
    """
    try:
        y, sr = librosa.load(wav_path, sr=SR, mono=True)
    except Exception as e:
        print(f"    Could not load {wav_path}: {e}")
        return []

    # RMS energy envelope
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0]
    if len(rms) == 0 or rms.max() == 0:
        return []
    
    # Smooth to merge very close syllables into words
    rms_smooth = uniform_filter1d(rms, size=9)

    # Dynamic threshold: above P40 of non-silent frames
    # (lowered from P60 to capture softer vocal sections — every sung word matters)
    nonzero = rms_smooth[rms_smooth > 0]
    if len(nonzero) == 0:
        return []
    threshold = float(np.percentile(nonzero, 40))

    # Find continuous regions above threshold (vocal activity)
    active = rms_smooth > threshold
    regions = []
    in_region = False
    start = 0
    for i in range(len(active)):
        if active[i] and not in_region:
            start = i
            in_region = True
        elif not active[i] and in_region:
            regions.append((start, i))
            in_region = False
    if in_region:
        regions.append((start, len(active)))

    # Convert frame regions to time-based phrases
    # Split any region longer than 6s at its deepest energy dips so we
    # keep word-level granularity without dropping long sections entirely.
    MAX_PHRASE = 6.0
    final_regions = []
    for start_f, end_f in regions:
        dur_frames = end_f - start_f
        dur_sec = librosa.frames_to_time(dur_frames, sr=sr, hop_length=HOP)
        if dur_sec <= MAX_PHRASE:
            final_regions.append((start_f, end_f))
        else:
            # Split at local energy minima within this region
            seg = rms_smooth[start_f:end_f]
            # Find local minima (dips) as split candidates
            from scipy.signal import argrelmin
            min_order = max(3, int(0.15 * sr / HOP))  # ~150ms neighborhood
            local_mins = argrelmin(seg, order=min_order)[0]
            if len(local_mins) == 0:
                # No dips found — keep as one long phrase
                final_regions.append((start_f, end_f))
            else:
                # Split at the deepest dips to keep sub-phrases <= MAX_PHRASE
                # Greedily split: walk forward, split when approaching MAX_PHRASE
                max_frames = int(MAX_PHRASE * sr / HOP)
                chunk_start = 0
                for mi in local_mins:
                    if mi - chunk_start >= max_frames:
                        # Find the most recent minimum before this point
                        final_regions.append((start_f + chunk_start, start_f + mi))
                        chunk_start = mi
                # Don't forget the last chunk
                final_regions.append((start_f + chunk_start, end_f))

    phrases = []
    for start_f, end_f in final_regions:
        t_start = librosa.frames_to_time(start_f, sr=sr, hop_length=HOP)
        t_end = librosa.frames_to_time(end_f, sr=sr, hop_length=HOP)
        dur = t_end - t_start

        # Skip very short blips (<80ms)
        if dur < 0.08:
            continue

        # Strength = peak energy in this region relative to overall max
        region_peak = float(rms_smooth[start_f:end_f].max())
        strength = region_peak / float(rms_smooth.max())

        phrases.append({
            "time": round(float(t_start), 4),
            "strength": round(float(strength), 4),
            "duration": round(float(dur), 3),
        })

    return phrases


def analyze_full_mix(wav_path):
    """BPM, beats, downbeats from full mix."""
    y, sr = librosa.load(wav_path, sr=SR, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames", trim=True)
    if hasattr(tempo, "__len__"):
        tempo = float(tempo[0]) if len(tempo) > 0 else 120.0
    else:
        tempo = float(tempo)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    bss = [float(onset_env[bf]) if bf < len(onset_env) else 0.0 for bf in beat_frames]
    best_phase, best_score = 0, -1
    for phase in range(4):
        score = sum(bss[i] for i in range(phase, len(bss), 4))
        if score > best_score:
            best_score = score
            best_phase = phase
    downbeat_times = [beat_times[i] for i in range(best_phase, len(beat_times), 4)]

    return {
        "bpm": round(tempo, 2),
        "duration": round(duration, 3),
        "beats": [round(t, 4) for t in beat_times],
        "downbeats": [round(t, 4) for t in downbeat_times],
    }


def process_song(wav_name):
    wav_path = os.path.join(SONGS_DIR, wav_name)
    song_name = os.path.splitext(wav_name)[0]
    json_path = os.path.join(SONGS_DIR, song_name + ".json")
    stems_dir = os.path.join(STEMS_DIR, song_name)

    print(f"\n{'='*60}")
    print(f"  {wav_name}")
    print(f"{'='*60}")

    # Step 1: Separate
    separate_song(wav_path, song_name)

    # Step 2: Full mix analysis (BPM, beats)
    print(f"  Analyzing full mix...")
    data = analyze_full_mix(wav_path)

    # Step 3: Full mix onsets (fallback)
    print(f"  Full mix onsets...")
    data["onsets"] = analyze_stem(wav_path)
    print(f"    -> {len(data['onsets'])} onsets")

    # Step 4: Per-stem analysis with DURATION
    data["stems"] = {}
    for stem in STEMS:
        stem_path = os.path.join(stems_dir, f"{stem}.wav")
        if not os.path.exists(stem_path):
            data["stems"][stem] = []
            print(f"  {stem} stem: NOT AVAILABLE")
            continue

        is_percussion = (stem == "drums")

        if stem == "vocals":
            # Vocals get special phrase/word detection
            print(f"  {stem} stem: vocal phrase detection...")
            phrases = analyze_vocal_phrases(stem_path)
            print(f"    -> {len(phrases)} vocal phrases")

            # Sensitive onset detection for vocals — lower thresholds capture
            # every syllable, not just the loudest peaks
            print(f"  {stem} stem: onset detection (sensitive)...")
            onsets = analyze_stem(stem_path, is_percussion=False,
                                 height_pct=35, prom_pct=25)
            print(f"    -> {len(onsets)} onsets from spectral flux")

            # Inject onsets at the START of every vocal phrase that doesn't
            # already have a nearby onset (within 80ms). This ensures every
            # sung word has at least one note in the game.
            onset_times_set = set(round(o["time"], 2) for o in onsets)
            injected = 0
            for p in phrases:
                # Check if any onset is within 80ms of phrase start
                has_nearby = any(abs(o["time"] - p["time"]) < 0.08 for o in onsets)
                if not has_nearby:
                    onsets.append({
                        "time": round(p["time"], 4),
                        "strength": round(p["strength"] * 0.8, 4),
                        "duration": round(p["duration"], 3),
                    })
                    injected += 1
            if injected > 0:
                onsets.sort(key=lambda o: o["time"])
                print(f"    -> +{injected} phrase-boundary onsets injected")
            print(f"    -> {len(onsets)} total vocal onsets")

            # Store both: phrases for hold notes, onsets for tap notes
            data["stems"]["vocals"] = onsets
            data["stems"]["vocal_phrases"] = phrases

            # Stats
            has_dur = sum(1 for p in phrases if p["duration"] > 0.15)
            print(f"    -> {has_dur} phrases with holdable duration (>150ms)")
        else:
            print(f"  {stem} stem onsets...")
            stem_data = analyze_stem(stem_path, is_percussion=is_percussion)
            data["stems"][stem] = stem_data
            has_dur = sum(1 for o in stem_data if o["duration"] > 0.15)
            print(f"    -> {len(stem_data)} onsets ({has_dur} with holdable duration)")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"  OK {song_name}.json  BPM={data['bpm']}")
    for stem in STEMS:
        count = len(data['stems'].get(stem, []))
        print(f"    {stem}: {count} onsets")
    vp = len(data['stems'].get('vocal_phrases', []))
    print(f"    vocal_phrases: {vp} phrases")


def main():
    global SONGS_DIR, STEMS_DIR
    parser = argparse.ArgumentParser(description="Analyze songs for Record Tap")
    parser.add_argument("--songs-dir", default=SONGS_DIR,
                        help="Directory containing WAV files and where JSON output goes")
    parser.add_argument("--stems-dir", default=STEMS_DIR,
                        help="Root directory for per-song stem subfolders")
    args = parser.parse_args()
    SONGS_DIR = os.path.abspath(args.songs_dir)
    STEMS_DIR = os.path.abspath(args.stems_dir)

    if not os.path.isdir(SONGS_DIR):
        print(f"Songs directory not found: {SONGS_DIR}")
        sys.exit(1)

    os.makedirs(STEMS_DIR, exist_ok=True)
    wav_files = sorted(f for f in os.listdir(SONGS_DIR) if f.lower().endswith(".wav"))

    if not wav_files:
        print("No WAV files found.")
        sys.exit(1)

    print(f"Found {len(wav_files)} WAV files")
    print(f"Stems -> {STEMS_DIR}\n")

    for wav_name in wav_files:
        try:
            process_song(wav_name)
        except Exception as e:
            print(f"  FATAL: {e}")

    print(f"\nAll done!")


if __name__ == "__main__":
    main()
