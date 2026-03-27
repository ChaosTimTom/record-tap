"""Quick test: verify gap fix produces even coverage for ALL songs."""
import json, os

songs_dir = "songs/downs-east"
songs = [f[:-5] for f in os.listdir(songs_dir) if f.endswith('.json')]

worst_gap = 0
worst_song = ""
worst_stem = ""

for song in sorted(songs):
    d = json.load(open(os.path.join(songs_dir, f"{song}.json")))
    dur = d["duration"]
    mx_play = sorted([o for o in d.get("onsets", []) if 1.5 <= o["time"] <= dur - 1 and o["strength"] > 0.05],
                     key=lambda x: x["time"])

    for stem_name in ["vocals", "drums", "bass", "other", "mix"]:
        if stem_name == "vocals":
            src = sorted([o for o in d["stems"].get("vocals", []) if 1.5 <= o["time"] <= dur - 1 and o["strength"] > 0.05],
                         key=lambda x: x["time"])
        elif stem_name == "mix":
            src = mx_play
        else:
            src = sorted([o for o in d["stems"].get(stem_name, []) if 1.5 <= o["time"] <= dur - 1 and o["strength"] > 0.05],
                         key=lambda x: x["time"])

        # Medium difficulty minGap
        min_gap = 0.16
        gapped = []
        for o in src:
            prev = gapped[-1] if gapped else None
            if not prev or o["time"] - prev["time"] >= min_gap:
                gapped.append(o)
            elif o["strength"] > prev["strength"]:
                gapped[-1] = o

        # Gap fill from mix (for non-mix stems)
        if stem_name != "mix" and gapped:
            gapped_times = [n["time"] for n in gapped]
            for i in range(1, len(gapped_times)):
                gap = gapped_times[i] - gapped_times[i - 1]
                if gap > 2.5:
                    gs, ge = gapped_times[i - 1], gapped_times[i]
                    go = [o for o in mx_play if o["time"] > gs + 0.3 and o["time"] < ge - 0.3]
                    last_t = gs
                    for o in sorted(go, key=lambda x: x["time"]):
                        if o["time"] - last_t >= 0.20:
                            gapped.append(o)
                            last_t = o["time"]
            gapped.sort(key=lambda n: n["time"])

        times = [n["time"] for n in gapped]
        if len(times) > 1:
            max_g = max(times[i + 1] - times[i] for i in range(len(times) - 1))
            g3 = sum(1 for i in range(len(times) - 1) if times[i + 1] - times[i] > 3)
        else:
            max_g = 0
            g3 = 0

        if max_g > worst_gap:
            worst_gap = max_g
            worst_song = song
            worst_stem = stem_name

        if g3 > 0:
            print(f"!! {song:40s} {stem_name:>6}: {len(gapped):>4} notes, max_gap={max_g:.1f}s, gaps>3s={g3}")

print(f"\nWorst gap: {worst_gap:.1f}s in '{worst_song}' [{worst_stem}]")
print("Done - any lines above indicate songs with gaps > 3s")

