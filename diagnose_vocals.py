"""
Diagnose vocal onset coverage gaps.

For each song, compare:
  1. vocal_phrases (word/phrase boundaries from RMS energy)
  2. vocal onsets (from spectral flux peak detection)
  3. Identify phrases that have ZERO onsets (= silent lyrics in-game)
"""
import json
import os
import glob

SONGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "songs", "downs-east")

json_files = sorted(glob.glob(os.path.join(SONGS_DIR, "*.json")))

total_phrases = 0
total_uncovered = 0
total_onsets = 0

for jf in json_files:
    data = json.load(open(jf, encoding='utf-8'))
    name = os.path.splitext(os.path.basename(jf))[0]
    
    phrases = data.get("stems", {}).get("vocal_phrases", [])
    onsets = data.get("stems", {}).get("vocals", [])
    mix_onsets = data.get("onsets", [])
    duration = data.get("duration", 0)
    
    if not phrases:
        continue
    
    # For each phrase, check if there's at least one vocal onset within it
    uncovered = []
    for p in phrases:
        p_start = p["time"]
        p_end = p["time"] + p.get("duration", 0)
        # Find onsets within this phrase (with small tolerance)
        hits = [o for o in onsets if o["time"] >= p_start - 0.1 and o["time"] <= p_end + 0.1]
        if len(hits) == 0:
            uncovered.append(p)
    
    total_phrases += len(phrases)
    total_uncovered += len(uncovered)
    total_onsets += len(onsets)
    
    coverage = (len(phrases) - len(uncovered)) / len(phrases) * 100 if phrases else 0
    
    print(f"\n{'='*60}")
    print(f"{name}")
    print(f"  Duration: {duration:.1f}s")
    print(f"  Vocal phrases: {len(phrases)}")
    print(f"  Vocal onsets:  {len(onsets)}")
    print(f"  Mix onsets:    {len(mix_onsets)}")
    print(f"  Phrase coverage: {coverage:.0f}% ({len(uncovered)} phrases with NO onset)")
    
    if uncovered:
        # Show gap details
        print(f"  Uncovered phrases:")
        for p in uncovered[:15]:  # Show first 15
            t = p["time"]
            dur = p.get("duration", 0)
            str_ = p.get("strength", 0)
            # Check if mix has onsets here
            mix_in_range = [o for o in mix_onsets if o["time"] >= t - 0.1 and o["time"] <= t + dur + 0.1]
            print(f"    {t:.1f}s-{t+dur:.1f}s (dur={dur:.2f}s, str={str_:.2f}) - mix onsets in range: {len(mix_in_range)}")
        if len(uncovered) > 15:
            print(f"    ... and {len(uncovered) - 15} more")
    
    onset_times = sorted([o["time"] for o in onsets])
    
    if len(onset_times) > 1:
        max_gap = 0
        gap_start = 0
        for i in range(1, len(onset_times)):
            g = onset_times[i] - onset_times[i-1]
            if g > max_gap:
                max_gap = g
                gap_start = onset_times[i-1]
        
        phrases_in_gap = [p for p in phrases if p["time"] >= gap_start and p["time"] <= gap_start + max_gap]
        if max_gap > 3:
            print(f"  WARNING Biggest onset gap: {max_gap:.1f}s at {gap_start:.1f}s ({len(phrases_in_gap)} phrases in gap)")

print(f"\n{'='*60}")
print(f"TOTALS:")
print(f"  Total phrases across all songs: {total_phrases}")
print(f"  Uncovered phrases (no onset):   {total_uncovered} ({total_uncovered/total_phrases*100:.1f}%)")
print(f"  Total vocal onsets:             {total_onsets}")
print(f"  Avg onsets per phrase:          {total_onsets/total_phrases:.1f}")
