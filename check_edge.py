"""Check the 2 remaining gap edge cases."""
import json

# Check Lobster Pots mix gap
d = json.load(open("songs/downs-east/Lobster Pots and Minivans Mastered full.json"))
dur = d["duration"]
mx = sorted([o for o in d["onsets"] if 1.5 <= o["time"] <= dur-1 and o["strength"] > 0.05], key=lambda x: x["time"])
gapped = []
for o in mx:
    prev = gapped[-1] if gapped else None
    if not prev or o["time"] - prev["time"] >= 0.16:
        gapped.append(o)
    elif o["strength"] > prev["strength"]:
        gapped[-1] = o
times = [g["time"] for g in gapped]
for i in range(1, len(times)):
    if times[i] - times[i-1] > 3:
        gs, ge = times[i-1], times[i]
        # Check ALL onsets (no threshold)
        all_in = [o for o in d["onsets"] if gs < o["time"] < ge]
        print(f"Lobster Pots MIX gap: {gs:.1f}-{ge:.1f} ({ge-gs:.1f}s)")
        print(f"  All mix onsets in gap (any strength): {len(all_in)}")
        if all_in:
            strengths = [o["strength"] for o in all_in]
            print(f"  Strengths: {min(strengths):.4f} - {max(strengths):.4f}")

# Check Blueberries vocal gap
print()
d2 = json.load(open("songs/downs-east/Blueberries and Beer.json"))
dur2 = d2["duration"]
vo = sorted([o for o in d2["stems"]["vocals"] if 1.5 <= o["time"] <= dur2-1 and o["strength"] > 0.05], key=lambda x: x["time"])
mx2 = sorted([o for o in d2["onsets"] if 1.5 <= o["time"] <= dur2-1 and o["strength"] > 0.05], key=lambda x: x["time"])

gapped2 = []
for o in vo:
    prev = gapped2[-1] if gapped2 else None
    if not prev or o["time"] - prev["time"] >= 0.16:
        gapped2.append(o)
    elif o["strength"] > prev["strength"]:
        gapped2[-1] = o

# Apply gap fill
times2 = [g["time"] for g in gapped2]
filled = list(gapped2)
for i in range(1, len(times2)):
    if times2[i] - times2[i-1] > 2.5:
        gs, ge = times2[i-1], times2[i]
        go = [o for o in mx2 if o["time"] > gs + 0.3 and o["time"] < ge - 0.3]
        last_t = gs
        for o in sorted(go, key=lambda x: x["time"]):
            if o["time"] - last_t >= 0.20:
                filled.append(o)
                last_t = o["time"]

filled.sort(key=lambda n: n["time"])
ftimes = [n["time"] for n in filled]
for i in range(1, len(ftimes)):
    if ftimes[i] - ftimes[i-1] > 3:
        gs, ge = ftimes[i-1], ftimes[i]
        all_mx_in = [o for o in d2["onsets"] if gs < o["time"] < ge]
        all_vo_in = [o for o in d2["stems"]["vocals"] if gs < o["time"] < ge]
        print(f"Blueberries VOCAL gap: {gs:.1f}-{ge:.1f} ({ge-gs:.1f}s)")
        print(f"  All mix onsets (any strength): {len(all_mx_in)}")
        print(f"  All vocal onsets (any strength): {len(all_vo_in)}")
        if all_mx_in:
            strengths = [o["strength"] for o in all_mx_in]
            print(f"  Mix strengths: {min(strengths):.4f} - {max(strengths):.4f}")
