"""
Verify onset detection quality and expose the grid-snapping problem.

1. Checks if onset times correspond to actual audio energy spikes
2. Simulates the current beatmap grid-snapping to show time shifts
3. Generates clicktrack WAV files so you can HEAR the correlation

Run:  python verify_onsets.py
"""

import json
import os
import numpy as np
import librosa
import soundfile as sf

SONGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "songs", "downs-east")
SR = 22050

def generate_click(sr=22050, freq=1000, duration=0.015, amplitude=0.8):
    """Generate a short click sound."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    click = amplitude * np.sin(2 * np.pi * freq * t)
    # Apply envelope
    env = np.exp(-t * 80)
    return (click * env).astype(np.float32)


def check_energy_at_onsets(y, sr, onsets, label):
    """Check if audio energy is higher at onset times vs random times.
    Uses frequency-band energy, not broadband RMS, because instruments
    are audible in specific frequency ranges."""
    hop = 512
    S = np.abs(librosa.stft(y, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr)

    # Use 40-4000 Hz range (covers kick, snare, vocals, bass, guitar)
    band = (freqs >= 40) & (freqs <= 4000)
    band_energy = S[band].mean(axis=0)

    # Energy at onset times (with +20ms lookahead for the attack transient)
    off = int(0.02 * sr / hop)
    onset_energies = []
    for o in onsets:
        idx = int(o['time'] * sr / hop)
        idx = min(idx + off, len(band_energy) - 1)
        onset_energies.append(band_energy[idx])

    # Energy at random times (for comparison)
    rng = np.random.default_rng(42)
    random_indices = rng.integers(0, len(band_energy), size=len(onsets))
    random_energies = [band_energy[i] for i in random_indices]

    onset_mean = np.mean(onset_energies)
    random_mean = np.mean(random_energies)
    ratio = onset_mean / random_mean if random_mean > 0 else float('inf')

    # Also test TOP 30% strongest onsets
    sorted_onsets = sorted(onsets, key=lambda o: o['strength'], reverse=True)
    top_n = max(1, len(sorted_onsets) // 3)
    top_energies = []
    for o in sorted_onsets[:top_n]:
        idx = int(o['time'] * sr / hop)
        idx = min(idx + off, len(band_energy) - 1)
        top_energies.append(band_energy[idx])
    top_ratio = np.mean(top_energies) / random_mean if random_mean > 0 else 0

    ok_all = '✓' if ratio > 1.2 else '~' if ratio > 1.05 else '✗'
    ok_top = '✓' if top_ratio > 1.2 else '~' if top_ratio > 1.05 else '✗'
    print(f"  {label}:")
    print(f"    All onsets: {ratio:.2f}x vs random {ok_all}  (n={len(onsets)})")
    print(f"    Top 30%:    {top_ratio:.2f}x vs random {ok_top}  (n={top_n})")
    return ratio


def simulate_grid_snap(analysis, stem_name):
    """Simulate the current beatmap.js grid-snapping and show time shifts."""
    beats = analysis['beats']
    bpm = analysis['bpm']
    onsets = analysis['stems'].get(stem_name, analysis.get('onsets', []))

    if not onsets or not beats:
        return

    # Build grid (beats + eighth-note midpoints), same as beatmap.js
    grid_ms = set()
    for i, b in enumerate(beats):
        grid_ms.add(round(b * 1000))
        if i + 1 < len(beats):
            mid = (b + beats[i + 1]) / 2
            grid_ms.add(round(mid * 1000))

    grid_list = sorted(grid_ms)

    # Snap each onset to nearest grid position
    shifts = []
    for o in onsets:
        if o['time'] < 1.5:
            continue
        onset_ms = round(o['time'] * 1000)
        best_dist = float('inf')
        for g in grid_list:
            dist = abs(g - onset_ms)
            if dist < best_dist:
                best_dist = dist
        shifts.append(best_dist)

    if not shifts:
        return

    shifts = np.array(shifts)
    print(f"  Grid-snap shifts for {stem_name}:")
    print(f"    Mean shift:   {shifts.mean():.1f} ms")
    print(f"    Median shift: {np.median(shifts):.1f} ms")
    print(f"    Max shift:    {shifts.max():.1f} ms")
    print(f"    >50ms:  {(shifts > 50).sum()}/{len(shifts)} ({(shifts > 50).mean()*100:.0f}%)")
    print(f"    >100ms: {(shifts > 100).sum()}/{len(shifts)} ({(shifts > 100).mean()*100:.0f}%)")
    print(f"    >200ms: {(shifts > 200).sum()}/{len(shifts)} ({(shifts > 200).mean()*100:.0f}%)")


def create_clicktrack(wav_path, onsets, out_path, stem_label, top_pct=0.30):
    """Mix clicks at onset times with original audio. Only uses top % by strength."""
    print(f"  Creating clicktrack: {os.path.basename(out_path)}")
    y, sr = sf.read(wav_path, dtype='float32')
    if y.ndim == 2:
        y = y.mean(axis=1)  # to mono

    click = generate_click(sr=sr, freq=1200, duration=0.02, amplitude=0.7)

    # Filter to top onsets by strength
    sorted_onsets = sorted(onsets, key=lambda o: o['strength'], reverse=True)
    keep = max(10, int(len(sorted_onsets) * top_pct))
    top_onsets = sorted_onsets[:keep]

    out = y.copy()
    for o in top_onsets:
        start = int(o['time'] * sr)
        end = start + len(click)
        if end <= len(out):
            out[start:end] += click

    # Normalize
    peak = np.max(np.abs(out))
    if peak > 0:
        out = out / peak * 0.95

    sf.write(out_path, out, sr)
    print(f"    → {keep} clicks from {len(onsets)} onsets ({top_pct*100:.0f}% strongest)")


def main():
    # Pick a test song
    test_song = "Lobstah Life"
    wav_path = os.path.join(SONGS_DIR, test_song + ".wav")
    json_path = os.path.join(SONGS_DIR, test_song + ".json")

    if not os.path.exists(wav_path) or not os.path.exists(json_path):
        print(f"Test song not found: {test_song}")
        return

    print(f"=== Verifying: {test_song} ===\n")

    with open(json_path) as f:
        analysis = json.load(f)

    print(f"BPM: {analysis['bpm']}, Duration: {analysis['duration']:.1f}s")
    print(f"Beats: {len(analysis['beats'])}, Onsets: {len(analysis['onsets'])}")
    for stem in ['vocals', 'drums', 'bass', 'other']:
        n = len(analysis['stems'].get(stem, []))
        print(f"  {stem}: {n} onsets")

    # Load audio for energy analysis
    print(f"\n--- Energy Correlation Test ---")
    print(f"(Higher ratio = onsets match actual audio events)\n")
    y, sr = librosa.load(wav_path, sr=SR, mono=True)

    # Check drums stem onsets against full mix audio
    for stem in ['drums', 'vocals', 'bass', 'other']:
        stem_onsets = analysis['stems'].get(stem, [])
        if stem_onsets:
            check_energy_at_onsets(y, SR, stem_onsets, f"{stem} onsets vs full mix")

    # Check full mix onsets
    check_energy_at_onsets(y, SR, analysis['onsets'], "full mix onsets vs full mix")

    # Show grid-snapping damage
    print(f"\n--- Grid-Snap Damage (current beatmap.js) ---")
    print(f"(Shows how much the beat grid shifts notes from real onset times)\n")
    for stem in ['drums', 'vocals', 'bass', 'other']:
        simulate_grid_snap(analysis, stem)
        print()

    # Generate clicktracks
    print(f"\n--- Generating Clicktrack WAVs ---")
    print(f"(Listen to these - clicks should land on audible hits)\n")

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_clicks")
    os.makedirs(out_dir, exist_ok=True)

    for stem in ['drums', 'vocals']:
        stem_onsets = analysis['stems'].get(stem, [])
        if stem_onsets:
            out_path = os.path.join(out_dir, f"{test_song} - {stem} clicks.wav")
            create_clicktrack(wav_path, stem_onsets, out_path, stem, top_pct=0.30)

    print(f"\n✓ Clicktrack files saved to: {out_dir}")
    print(f"  Play these in any audio player - you should hear clicks")
    print(f"  landing exactly on drum hits / vocal phrases.")

    # ── Beatmap Simulation ──
    print(f"\n--- Beatmap Simulation (before vs after) ---\n")
    stem = 'drums'
    onsets = analysis['stems'][stem]
    beats = analysis['beats']
    bpm = analysis['bpm']
    dur = analysis['duration']
    beat_interval = 60 / bpm

    # OLD METHOD: Grid-snap to beats + eighth notes
    grid_ms = set()
    for i, b in enumerate(beats):
        grid_ms.add(round(b * 1000))
        if i + 1 < len(beats):
            mid = (b + beats[i + 1]) / 2
            grid_ms.add(round(mid * 1000))
    grid_list = sorted(grid_ms)

    old_notes = []
    snapped = {}
    for o in onsets:
        if o['time'] < 1.5 or o['time'] > dur - 1.0:
            continue
        onset_ms = round(o['time'] * 1000)
        best_g = min(grid_list, key=lambda g: abs(g - onset_ms))
        if abs(best_g - onset_ms) <= beat_interval * 500:
            if best_g not in snapped or o['strength'] > snapped[best_g]['strength']:
                snapped[best_g] = o
    old_times = sorted(snapped.keys())
    # Take top N after scoring
    scored = [(ms, snapped[ms]['strength'] + 0.15) for ms in old_times]
    scored.sort(key=lambda x: x[1], reverse=True)
    target = int(bpm / 120 * 0.8 * (dur - 2.5))
    old_final = sorted([ms / 1000 for ms, _ in scored[:target]])

    # NEW METHOD: Direct onset times, top 38% by strength (medium difficulty)
    playable = [o for o in onsets if 1.5 <= o['time'] <= dur - 1.0 and o['strength'] > 0]
    by_str = sorted(playable, key=lambda o: o['strength'], reverse=True)
    keep = max(10, int(len(playable) * 0.38))
    strong = by_str[:keep]
    strong.sort(key=lambda o: o['time'])
    new_final = []
    for o in strong:
        if not new_final or o['time'] - new_final[-1] >= 0.26:
            new_final.append(o['time'])
        elif o['strength'] > next((x['strength'] for x in strong if abs(x['time'] - new_final[-1]) < 0.01), 0):
            new_final[-1] = o['time']

    print(f"  OLD (grid-snapped): {len(old_final)} notes")
    print(f"  NEW (direct times): {len(new_final)} notes")
    print(f"  OLD notes/sec: {len(old_final)/(dur-2.5):.2f}")
    print(f"  NEW notes/sec: {len(new_final)/(dur-2.5):.2f}")

    # Compare: how many OLD notes are within 30ms of an actual onset?
    hit_count_old = sum(1 for t in old_final if any(abs(t - o['time']) < 0.03 for o in onsets[:200]))
    hit_count_new = sum(1 for t in new_final[:len(old_final)] if any(abs(t - o['time']) < 0.03 for o in onsets[:200]))
    print(f"\n  Notes within 30ms of an actual audio event (first 200 onsets):")
    print(f"    OLD: {hit_count_old}/{min(len(old_final),200)} ({hit_count_old/min(len(old_final),200)*100:.0f}%)")
    print(f"    NEW: {hit_count_new}/{min(len(new_final),200)} ({hit_count_new/min(len(new_final),200)*100:.0f}%)")
    print(f"\n  (NEW should be 100% because notes ARE the onset times)")


if __name__ == "__main__":
    main()
