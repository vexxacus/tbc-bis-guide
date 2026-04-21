import json

with open("data.json") as f:
    d = json.load(f)

for s in d["specs"]:
    cn = s["className"]
    sn = s["specName"]
    if sn in ("Holy", "Restoration"):
        print(f"\n=== {cn} {sn} ===")
        for p in s["phases"]:
            pn = p["phase"]
            ids = []
            for sg in p.get("slotGroups", []):
                for item in sg.get("items", []):
                    ids.append(item.get("itemId", 0))
            print(f"  Phase {pn}: {len(ids)} items, first 5: {ids[:5]}")
