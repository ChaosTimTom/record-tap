#!/usr/bin/env python3
"""Build precomputed rhythm charts from analysis JSON files.

Outputs one <song>.chart.json next to each analysis file.
The runtime then only loads these prebuilt charts.
"""

from __future__ import annotations

import argparse
import bisect
import glob
import json
import math
import os
import random
from typing import Dict, List, Optional

DIFFICULTIES = {
    "beginner": {"id": "beginner", "noteFrequency": 0.25, "lanes": 5},
    "easy": {"id": "easy", "noteFrequency": 0.45, "lanes": 5},
    "medium": {"id": "medium", "noteFrequency": 0.7, "lanes": 5},
    "hard": {"id": "hard", "noteFrequency": 1.0, "lanes": 5},
}

INSTRUMENTS = ["vocals", "drums", "bass", "other", "mix"]


def r3(value: float) -> float:
    return round(float(value), 3)


def clip(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def seed_for(song_key: str) -> int:
    seed = 0
    for ch in song_key:
        seed = ((seed << 5) - seed) + ord(ch)
        seed &= 0xFFFFFFFF
    return seed


def strength_floor(onsets: List[dict], keep_pct: float) -> float:
    if not onsets:
        return 0.1
    strengths = sorted(float(o.get("strength", 0.0)) for o in onsets)
    idx = int(math.floor(len(strengths) * (1.0 - keep_pct)))
    idx = clip(idx, 0, len(strengths) - 1)
    return strengths[idx]


def closest_onset_time(target_time: float, onsets: List[dict], max_dist: float = 0.2) -> Optional[float]:
    best_time = None
    best_dist = max_dist
    for o in onsets:
        t = float(o.get("time", 0.0))
        d = abs(t - target_time)
        if d < best_dist:
            best_dist = d
            best_time = t
    return best_time


def profile_from_freq(freq: float) -> dict:
    if freq <= 0.3:
        return {
            "use_holds": False,
            "min_hold": 999.0,
            "min_gap": 0.95,
            "keep_pct": 0.12,
            "use_chords": False,
            "chord_threshold": 999.0,
            "max_chord": 1,
        }
    if freq <= 0.5:
        return {
            "use_holds": True,
            "min_hold": 0.50,
            "min_gap": 0.62,
            "keep_pct": 0.22,
            "use_chords": False,
            "chord_threshold": 999.0,
            "max_chord": 1,
        }
    if freq <= 0.8:
        return {
            "use_holds": True,
            "min_hold": 0.30,
            "min_gap": 0.38,
            "keep_pct": 0.35,
            "use_chords": True,
            "chord_threshold": 0.86,
            "max_chord": 2,
        }
    return {
        "use_holds": True,
        "min_hold": 0.20,
        "min_gap": 0.24,
        "keep_pct": 0.50,
        "use_chords": True,
        "chord_threshold": 0.80,
        "max_chord": 2,
    }


def subdivision_for(diff_id: str, instrument: str) -> int:
    if diff_id == "beginner":
        return 1
    if diff_id == "easy":
        return 2
    if diff_id == "medium":
        return 4
    if instrument == "drums":
        return 6
    return 4


def build_grid(beats: List[float], subdivision: int) -> List[float]:
    if len(beats) < 2:
        return []
    grid: List[float] = []
    for i in range(len(beats) - 1):
        a = float(beats[i])
        b = float(beats[i + 1])
        if b <= a:
            continue
        step = (b - a) / subdivision
        for s in range(subdivision):
            grid.append(a + s * step)
    return grid


def select_grid_events(onsets: List[dict], beats: List[float], diff_id: str, instrument: str) -> List[dict]:
    if not onsets:
        return []
    if not beats or len(beats) < 2:
        return sorted(onsets, key=lambda o: float(o.get("time", 0.0)))

    sub = subdivision_for(diff_id, instrument)
    grid = build_grid(beats, sub)
    if not grid:
        return sorted(onsets, key=lambda o: float(o.get("time", 0.0)))

    avg_beat = (beats[-1] - beats[0]) / max(1, (len(beats) - 1))
    window = min(0.11, max(0.05, avg_beat / (sub * 1.4)))
    buckets: Dict[int, List[dict]] = {}

    grid_sorted = sorted(grid)
    for o in onsets:
        t = float(o.get("time", 0.0))
        pos = bisect.bisect_left(grid_sorted, t)
        candidate_idxs = []
        if pos < len(grid_sorted):
            candidate_idxs.append(pos)
        if pos > 0:
            candidate_idxs.append(pos - 1)
        if not candidate_idxs:
            continue

        best_idx = min(candidate_idxs, key=lambda idx: abs(grid_sorted[idx] - t))
        if abs(grid_sorted[best_idx] - t) <= window:
            buckets.setdefault(best_idx, []).append(o)

    selected: List[dict] = []
    for idx in sorted(buckets.keys()):
        cluster = buckets[idx]
        strongest = max(cluster, key=lambda x: float(x.get("strength", 0.0)))
        snapped_t = grid_sorted[idx]
        orig_t = float(strongest.get("time", 0.0))

        # Keep a little performance feel while still matching the beat lane.
        strongest = dict(strongest)
        strongest["time"] = r3((snapped_t * 0.7) + (orig_t * 0.3))
        strongest["gridTime"] = r3(snapped_t)
        selected.append(strongest)

    return selected


def map_lane_from_phrase(time_val: float, phrases: List[dict], lanes: int) -> Optional[int]:
    for i, p in enumerate(phrases):
        pt = float(p.get("time", 0.0))
        pd = max(0.4, float(p.get("duration", 0.0) or 0.0))
        if time_val >= pt - 0.08 and time_val <= pt + pd + 0.08:
            pos = max(0.0, min(1.0, (time_val - pt) / pd))
            mapped = pos if (i % 2 == 0) else (1.0 - pos)
            return clip(int(math.floor(mapped * lanes)), 0, lanes - 1)
    return None


def snap_time_to_grid(time_val: float, bpm: float, division: int) -> float:
    if bpm <= 0:
        return time_val
    beat = 60.0 / bpm
    grid = beat / max(1, division)
    return round(round(time_val / grid) * grid, 3)


def simplify_beginner_pattern(notes: List[dict], bpm: float) -> List[dict]:
    if not notes:
        return notes
    beat = 60.0 / bpm if bpm > 0 else 0.5
    out: List[dict] = []
    for idx, n in enumerate(notes):
        t = float(n["time"])
        phase = (t / beat) % 1.0
        near_beat = min(phase, 1.0 - phase) < 0.18
        if near_beat or idx % 2 == 0:
            nn = dict(n)
            nn["time"] = snap_time_to_grid(t, bpm, 2)
            out.append(nn)
    # Remove accidental duplicates created by snapping.
    dedup: Dict[tuple, dict] = {}
    for n in out:
        dedup[(n["time"], n["lane"])] = n
    return sorted(dedup.values(), key=lambda x: (x["time"], x["lane"]))


def annotate_hopo_and_overdrive(notes: List[dict], bpm: float, diff_id: str) -> List[dict]:
    if not notes:
        return notes

    beat = 60.0 / bpm if bpm > 0 else 0.5
    hopo_limit = min(0.22, beat * 0.52)

    by_time: Dict[float, List[dict]] = {}
    for n in notes:
        by_time.setdefault(float(n["time"]), []).append(n)

    single_taps = [
        v[0] for _, v in sorted(by_time.items(), key=lambda x: x[0])
        if len(v) == 1 and v[0].get("type") == "tap"
    ]

    prev = None
    for note in single_taps:
        note["hopo"] = False
        if prev is not None:
            dt = float(note["time"]) - float(prev["time"])
            if dt > 0 and dt <= hopo_limit and note["lane"] != prev["lane"]:
                note["hopo"] = True
        prev = note

    # Place overdrive phrases (8-note windows every ~32 notes).
    phrase_step = 32 if diff_id in ("medium", "hard") else 40
    phrase_len = 8 if diff_id in ("medium", "hard") else 6
    playable = [n for n in notes if n.get("type") in ("tap", "hold")]
    for i in range(0, len(playable), phrase_step):
        phrase = playable[i:i + phrase_len]
        if len(phrase) < max(4, phrase_len // 2):
            continue
        for n in phrase:
            n["overdrive"] = True

    return notes


def finalize_notes(notes: List[dict], bpm: float, diff_id: str, instrument: str) -> List[dict]:
    if not notes:
        return notes

    # Snap rhythm to grid by difficulty to improve readability.
    if diff_id == "beginner":
        notes = simplify_beginner_pattern(notes, bpm)
    else:
        division = 4 if diff_id == "easy" else 8
        for n in notes:
            n["time"] = snap_time_to_grid(float(n["time"]), bpm, division)

    notes.sort(key=lambda x: (x["time"], x["lane"]))

    if instrument != "vocals":
        notes = annotate_hopo_and_overdrive(notes, bpm, diff_id)

    return notes


def choose_onsets(analysis: dict, instrument: str) -> tuple[List[dict], List[dict]]:
    stems = analysis.get("stems") or {}
    if instrument == "vocals":
        phrases = stems.get("vocal_phrases") or []
        if phrases:
            vocal_onsets = stems.get("vocals") or phrases
            return vocal_onsets, phrases
    if instrument != "mix":
        stem = stems.get(instrument)
        if isinstance(stem, list) and stem:
            return stem, []
    return (analysis.get("onsets") or []), []


def playable_onsets(onsets: List[dict], duration: float) -> List[dict]:
    skip_lead = 1.5
    skip_end = 1.0
    end = max(skip_lead, duration - skip_end)
    return [
        o for o in onsets
        if float(o.get("time", 0.0)) >= skip_lead
        and float(o.get("time", 0.0)) <= end
        and float(o.get("strength", 0.0)) > 0.0
    ]


def map_vocal_holds(phrases: List[dict], tap_onsets: List[dict], min_hold: float) -> Dict[int, float]:
    hold_map: Dict[int, float] = {}
    for p in phrases:
        p_time = float(p.get("time", 0.0))
        p_dur = float(p.get("duration", 0.0))
        if p_dur < min_hold:
            continue
        closest = closest_onset_time(p_time, tap_onsets)
        if closest is None:
            continue
        key = int(round(closest * 1000))
        hold_map[key] = max(hold_map.get(key, 0.0), min(p_dur, 3.0))
    return hold_map


def enforce_gap(onsets: List[dict], min_gap: float) -> List[dict]:
    out: List[dict] = []
    for o in sorted(onsets, key=lambda x: float(x.get("time", 0.0))):
        if not out:
            out.append(o)
            continue
        prev = out[-1]
        dt = float(o.get("time", 0.0)) - float(prev.get("time", 0.0))
        if dt >= min_gap:
            out.append(o)
        elif float(o.get("strength", 0.0)) > float(prev.get("strength", 0.0)):
            out[-1] = o
    return out


def generate_vocal_notes(song_key: str, playable: List[dict], phrases: List[dict], diff: dict) -> List[dict]:
    freq = float(diff.get("noteFrequency", 0.5))
    lanes = int(diff.get("lanes", 5))
    profile = profile_from_freq(freq)

    floor = strength_floor(playable, profile["keep_pct"])
    kept = [o for o in playable if float(o.get("strength", 0.0)) >= floor]
    kept = enforce_gap(kept, profile["min_gap"])
    if not kept:
        return []

    hold_map = map_vocal_holds(phrases, kept, profile["min_hold"])
    max_strength = max(float(o.get("strength", 0.0)) for o in kept) or 0.1

    notes: List[dict] = []
    last_lane = -1
    for o in kept:
        time = float(o.get("time", 0.0))
        strength = float(o.get("strength", 0.0))

        lane = map_lane_from_phrase(time, phrases, lanes)
        if lane is None:
            lane = int(math.floor((strength / max_strength) * lanes))
            lane = clip(lane, 0, lanes - 1)

        if last_lane >= 0 and abs(lane - last_lane) > 2:
            lane = clip(last_lane + (2 if lane > last_lane else -2), 0, lanes - 1)
        last_lane = lane

        key = int(round(time * 1000))
        hold_dur = hold_map.get(key)

        if profile["use_holds"] and hold_dur and hold_dur >= profile["min_hold"]:
            notes.append({"time": r3(time), "lane": lane, "type": "hold", "holdDuration": r3(hold_dur)})
        else:
            notes.append({"time": r3(time), "lane": lane, "type": "tap"})

    return notes


def generate_instrument_notes(song_key: str, instrument: str, playable: List[dict], diff: dict, beats: List[float], downbeats: List[float]) -> List[dict]:
    freq = float(diff.get("noteFrequency", 0.5))
    lanes = int(diff.get("lanes", 5))
    profile = profile_from_freq(freq)
    if instrument == "bass":
        profile["max_chord"] = min(profile["max_chord"], 2)
        profile["chord_threshold"] = max(profile["chord_threshold"], 0.78)
    if instrument == "drums":
        profile["use_holds"] = False
        profile["max_chord"] = min(profile["max_chord"], 2)
    rng = random.Random(seed_for(f"{song_key}:{instrument}:{diff['id']}"))

    # Beat-anchor events first so note placement follows musical pulse.
    diff_id = str(diff.get("id", "easy"))
    anchored = select_grid_events(playable, beats, diff_id, instrument)
    if anchored:
        playable = anchored

    floor = strength_floor(playable, profile["keep_pct"])
    kept = [o for o in playable if float(o.get("strength", 0.0)) >= floor]
    kept = enforce_gap(kept, profile["min_gap"])
    if not kept:
        return []

    max_strength = max(float(o.get("strength", 0.0)) for o in kept) or 0.1
    notes: List[dict] = []
    last_lane = -1

    for idx, o in enumerate(kept):
        t = float(o.get("time", 0.0))
        s = float(o.get("strength", 0.0))
        d = float(o.get("duration", 0.0))

        prev_gap = 999.0
        if idx > 0:
            prev_gap = t - float(kept[idx - 1].get("time", 0.0))

        lane = clip(int(round((s / max_strength) * (lanes - 1))), 0, lanes - 1)
        if instrument == "drums":
            # Drums: force a stable kit-like lane grammar.
            if downbeats:
                nearest_down = min(downbeats, key=lambda db: abs(float(db) - t))
                if abs(float(nearest_down) - t) <= 0.10:
                    lane = 1 if (idx % 2 == 0) else 2
                elif prev_gap < 0.22:
                    lane = 3
                else:
                    lane = 0 if s < (max_strength * 0.55) else 2
            elif prev_gap < 0.22:
                lane = 3

        lane_jump_limit = 1 if instrument == "bass" else 2
        if last_lane >= 0 and prev_gap >= 0.22 and abs(lane - last_lane) > lane_jump_limit:
            lane = clip(last_lane + (lane_jump_limit if lane > last_lane else -lane_jump_limit), 0, lanes - 1)
        last_lane = lane

        is_hold = profile["use_holds"] and instrument != "drums" and d >= profile["min_hold"]
        hold_len = r3(min(d, 2.0)) if is_hold else None

        if is_hold:
            notes.append({"time": r3(t), "lane": lane, "type": "hold", "holdDuration": hold_len})
        else:
            notes.append({"time": r3(t), "lane": lane, "type": "tap"})

        if profile["use_chords"] and s >= profile["chord_threshold"]:
            extras = min(profile["max_chord"] - 1, lanes - 1)
            # Keep chords tied to structural accents only.
            is_structural = False
            if downbeats:
                nearest_down = min(downbeats, key=lambda db: abs(float(db) - t))
                is_structural = abs(float(nearest_down) - t) <= 0.09
            if not is_structural:
                extras = 0
            used = {lane}
            for _ in range(extras):
                choices = [l for l in range(lanes) if l not in used]
                if not choices:
                    break
                adjacent = [l for l in choices if abs(l - lane) <= 2]
                if adjacent and rng.random() > 0.5:
                    lane2 = rng.choice(adjacent)
                else:
                    lane2 = rng.choice(choices)
                used.add(lane2)
                note = {"time": r3(t), "lane": lane2, "type": "hold" if is_hold else "tap"}
                if is_hold:
                    note["holdDuration"] = hold_len
                notes.append(note)

    notes.sort(key=lambda n: (n["time"], n["lane"]))
    return notes


def fill_mix_gaps(notes: List[dict], analysis: dict, diff: dict, song_key: str) -> List[dict]:
    if not notes:
        return notes
    freq = float(diff.get("noteFrequency", 0.5))
    lanes = int(diff.get("lanes", 5))
    rng = random.Random(seed_for(f"{song_key}:{diff['id']}:mixfill"))

    mix_onsets = [o for o in (analysis.get("onsets") or []) if float(o.get("strength", 0.0)) > 0.05]
    mix_onsets.sort(key=lambda x: float(x.get("time", 0.0)))

    min_gap = 0.55 if freq <= 0.3 else (0.35 if freq <= 0.5 else (0.20 if freq <= 0.8 else 0.12))
    gap_threshold = 2.5

    merged = list(notes)
    merged.sort(key=lambda n: n["time"])
    times = [n["time"] for n in merged]
    if len(times) < 2:
        return merged

    gaps = []
    for i in range(1, len(times)):
        if times[i] - times[i - 1] > gap_threshold:
            gaps.append((times[i - 1], times[i]))

    fillers = []
    last_lane = -1
    for start, end in gaps:
        last_time = start
        for o in mix_onsets:
            t = float(o.get("time", 0.0))
            if t <= start + 0.3 or t >= end - 0.3:
                continue
            if t - last_time < min_gap:
                continue
            lane = rng.randrange(lanes)
            if lane == last_lane and lanes > 1:
                lane = (lane + 1 + rng.randrange(lanes - 1)) % lanes
            last_lane = lane
            last_time = t
            fillers.append({"time": r3(t), "lane": lane, "type": "tap"})

    merged.extend(fillers)
    merged.sort(key=lambda n: (n["time"], n["lane"]))
    return merged


def build_chart_for_analysis(analysis_path: str) -> dict:
    with open(analysis_path, "r", encoding="utf-8") as f:
        analysis = json.load(f)

    bpm = float(analysis.get("bpm", 120.0))
    duration = float(analysis.get("duration", 0.0))
    beats = [float(b) for b in (analysis.get("beats") or [])]
    downbeats = [float(b) for b in (analysis.get("downbeats") or [])]
    base_name = os.path.basename(analysis_path)

    charts = {inst: {diff_id: [] for diff_id in DIFFICULTIES} for inst in INSTRUMENTS}

    for inst in INSTRUMENTS:
        raw_onsets, phrases = choose_onsets(analysis, inst)
        playable = playable_onsets(raw_onsets, duration)
        for diff_id, diff in DIFFICULTIES.items():
            song_key = f"{base_name}:{inst}:{diff_id}"
            if inst == "vocals":
                notes = generate_vocal_notes(song_key, playable, phrases, diff)
            else:
                notes = generate_instrument_notes(song_key, inst, playable, diff, beats, downbeats)

            if inst == "mix":
                notes = fill_mix_gaps(notes, analysis, diff, song_key)

            notes = finalize_notes(notes, bpm, diff_id, inst)

            charts[inst][diff_id] = notes

    return {
        "schemaVersion": 1,
        "sourceAnalysis": base_name,
        "bpm": r3(bpm),
        "duration": r3(duration),
        "charts": charts,
    }


def chart_output_path(analysis_path: str) -> str:
    root, _ = os.path.splitext(analysis_path)
    return f"{root}.chart.json"


def iter_analysis_files(songs_dir: str) -> List[str]:
    files = sorted(glob.glob(os.path.join(songs_dir, "*.json")))
    return [p for p in files if not p.endswith(".chart.json")]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build precomputed charts from analysis JSON")
    parser.add_argument("--songs-dir", default=os.path.join("songs", "downs-east"), help="Directory containing analysis JSON files")
    parser.add_argument("--dry-run", action="store_true", help="Build and validate charts without writing files")
    args = parser.parse_args()

    analysis_files = iter_analysis_files(args.songs_dir)
    if not analysis_files:
        print(f"No analysis files found in: {args.songs_dir}")
        return 1

    built = 0
    for path in analysis_files:
        chart = build_chart_for_analysis(path)
        out_path = chart_output_path(path)
        if not args.dry_run:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(chart, f, ensure_ascii=True, indent=2)
        built += 1

        hard_mix = len(chart["charts"]["mix"]["hard"])
        print(f"Built {os.path.basename(out_path)} | hard/mix notes: {hard_mix}")

    print(f"Done. {'Validated' if args.dry_run else 'Wrote'} {built} chart files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
