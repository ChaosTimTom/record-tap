"""Debug: understand exactly what vocal data we have and what notes get generated."""
import json, os

songs_dir = "songs/downs-east"
songs = [f[:-5] for f in os.listdir(songs_dir) if f.endswith('.json')]

for song in sorted(songs):
    d = json.load(open(os.path.join(songs_dir, f"{song}.json")))
    dur = d["duration"]
    vp = d["stems"].get("vocal_phrases", [])
    vo = d["stems"].get("vocals", [])
    mx = d.get("onsets", [])

    vp_play = [p for p in vp if 1.5 <= p["time"] <= dur - 1 and p["strength"] > 0]
    vo_play = sorted([o for o in vo if 1.5 <= o["time"] <= dur - 1 and o["strength"] > 0.05],
                     key=lambda x: x["time"])
    mx_play = sorted([o for o in mx if 1.5 <= o["time"] <= dur - 1 and o["strength"] > 0.05],
                     key=lambda x: x["time"])

    # NEW approach: use ALL vocal onsets, enrich with phrase durations
    # Simulate for medium difficulty (freq=0.7, minGap=0.16)
    min_gap = 0.16

    gapped = []
    for o in vo_play:
        prev = gapped[-1] if gapped else None
        if not prev or o["time"] - prev["time"] >= min_gap:
            gapped.append(o)
        elif o["strength"] > prev["strength"]:
            gapped[-1] = o

    # Gap-fill from mix for remaining gaps
    gapped_times = sorted(n["time"] for n in gapped)
    big_gaps = []
    for i in range(1, len(gapped_times)):
        gap = gapped_times[i] - gapped_times[i-1]
        if gap > 2.5:
            big_gaps.append((gapped_times[i-1], gapped_times[i], gap))
    
    fill_count = 0
    for gs, ge, _ in big_gaps:
        go = [o for o in mx_play if o["time"] > gs + 0.3 and o["time"] < ge - 0.3]
        last_t = gs
        for o in sorted(go, key=lambda x: x["time"]):
            if o["time"] - last_t >= 0.20:
                fill_count += 1
                last_t = o["time"]

    total_notes = len(gapped) + fill_count
    nps = total_notes / (dur - 2.5) if dur > 2.5 else 0

    # Also get drums for comparison
    dr = d["stems"].get("drums", [])
    dr_play = sorted([o for o in dr if 1.5 <= o["time"] <= dur - 1 and o["strength"] > 0.05],
                     key=lambda x: x["time"])
    dr_gapped = []
    for o in dr_play:
        prev = dr_gapped[-1] if dr_gapped else None
        if not prev or o["time"] - prev["time"] >= 0.16:
            dr_gapped.append(o)

    # Max gap after gapped (before fill)
    if len(gapped_times) > 1:
        max_gap = max(gapped_times[i+1] - gapped_times[i] for i in range(len(gapped_times)-1))
        gaps_3s = sum(1 for i in range(len(gapped_times)-1) if gapped_times[i+1] - gapped_times[i] > 3)
    else:
        max_gap = 0
        gaps_3s = 0

    # Max gap AFTER fill (what the player actually experiences)
    all_notes = list(gapped)
    for gs, ge, _ in big_gaps:
        go = [o for o in mx_play if o["time"] > gs + 0.3 and o["time"] < ge - 0.3]
        last_t = gs
        for o in sorted(go, key=lambda x: x["time"]):
            if o["time"] - last_t >= 0.20:
                all_notes.append(o)
                last_t = o["time"]
    
    all_times = sorted(n["time"] for n in all_notes)
    if len(all_times) > 1:
        post_max_gap = max(all_times[i+1] - all_times[i] for i in range(len(all_times)-1))
        post_gaps_3s = sum(1 for i in range(len(all_times)-1) if all_times[i+1] - all_times[i] > 3)
    else:
        post_max_gap = 0
        post_gaps_3s = 0

    print(f"{song:45s} | voc:{len(gapped):>4} +fill:{fill_count:>3} = {total_notes:>4} ({nps:.1f}/s) | post-fill max:{post_max_gap:.1f}s gaps>3s:{post_gaps_3s} | drums:{len(dr_gapped):>4} ({len(dr_gapped)/(dur-2.5):.1f}/s)")
