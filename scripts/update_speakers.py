"""Apply reviewed public speaker records and save versioned snapshots in KST."""
import argparse
from collections import Counter
from datetime import datetime
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data.js"
HISTORY = ROOT / "db-history"
PREFIX = "window.SPEAKERS = "


def key(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def unique(items):
    return list({key(item): item for item in reversed(items) if key(item)}.values())[::-1]


def fields(value):
    return re.split(r"[;,\n]", value)


def good_url(value):
    parsed = urlsplit(value)
    return parsed.scheme in {"https", "http"} and bool(parsed.netloc)


def event_key(event):
    return tuple(key(event.get(field, "")) for field in ("title", "date", "host"))


def apply(rows, updates):
    counts = Counter()
    by_id = {row["id"]: row for row in rows}
    if len(by_id) != len(rows):
        raise ValueError("Existing DB has duplicate IDs.")
    seen = set()
    for update in updates:
        name, role = (update[field].strip() for field in ("name", "role"))
        if not name or not role or not good_url(update["source"]):
            raise ValueError("Each update requires a name, role and public URL.")
        identity = (key(name),key(role))
        if identity in seen:
            raise ValueError(f"Repeated update for {name}.")
        seen.add(identity)
        same_name = [row for row in rows if key(row["name"]) == identity[0]]
        matches = [row for row in same_name if key(row["role"]) == identity[1]]
        row = by_id.get(update.get("matchId"))
        if update.get("matchId") and (not row or row not in same_name):
            raise ValueError(f"Invalid confirmed ID for {name}.")
        if not row and update.get("merge") and len(same_name) == 1:
            row = same_name[0]
        if not row and len(matches) == 1:
            row = matches[0]
        if not row and same_name and not update.get("confirmedDistinct"):
            raise ValueError(f"Review possible namesake before adding {name}.")
        if not row:
            speaker_id = "public-" + sha256("|".join(identity).encode()).hexdigest()[:16]
            row = dict(id=speaker_id,name=name,role=role,year="",photo="",source=update["source"],
                       category="",topics=[],career=[],events=[],reviews=[])
            rows.append(row)
            by_id[speaker_id] = row
            counts["added"] += 1
        else:
            counts["merged"] += 1
        row["category"] = ", ".join(unique([v.strip() for v in fields(row["category"])+fields(update.get("category",""))]))
        for field in ("topics","career"):
            row[field] = unique(row[field]+update.get(field,[]))
        if good_url(update.get("photo","")) and not row["photo"]:
            row["photo"] = update["photo"]
        refs = list(row.get("sources",[]))
        if row["source"] != update["source"]:
            refs.append(dict(label="추가 공개 프로필 ↗",url=update["source"]))
        refs.extend(update.get("sources",[]))
        row["sources"] = list({ref["url"]:ref for ref in reversed(refs) if good_url(ref["url"])}.values())[::-1]
        keys = {event_key(e) for e in row["events"]}
        for event in update.get("events",[]):
            if not event["title"] or not good_url(event["source"]):
                raise ValueError(f"Unverified event for {name}.")
            identity = event_key(event)
            if identity not in keys:
                event_id = "event-" + sha256("|".join((row["id"],*identity)).encode()).hexdigest()[:16]
                row["events"].append(dict(event,id=event_id))
                keys.add(identity)
                counts["events"] += 1
    return counts


def write_index():
    links = []
    for path in sorted(HISTORY.glob("speaker_db_*.js"),key=lambda p:p.name,reverse=True):
        title = path.stem.removeprefix("speaker_db_")
        links.append(f'<li><a href="{escape(path.name)}" download>{escape(title)}</a></li>')
    (HISTORY / "index.html").write_text(
        '<!doctype html><html lang="ko"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>공개 강사 DB 이전 버전</title><link rel="stylesheet" href="../style.css">'
        '<main><p><a href="../">강사 아카이브</a></p><h1>공개 강사 DB 이전 버전</h1>'
        '<p>파일명은 한국시간 기준입니다. 공개 목록만 포함합니다.</p><ul>'
        + "".join(links) + "</ul></main></html>","utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("updates",type=Path)
    args = parser.parse_args()
    old = DATA.read_text("utf-8")
    rows = json.loads(old.removeprefix(PREFIX).strip().removesuffix(";"))
    counts = apply(rows,json.loads(args.updates.read_text("utf-8")))
    result = PREFIX + json.dumps(rows,ensure_ascii=False,indent=2) + ";\n"
    if result == old:
        print("No changes to the public speaker database.")
        return
    stamp = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d_%H%M%S_%f_KST")
    HISTORY.mkdir(exist_ok=True)
    if not any(path.read_text("utf-8") == old for path in HISTORY.glob("speaker_db_*.js")):
        (HISTORY / f"speaker_db_{stamp}_prior.js").write_text(old,"utf-8")
    (HISTORY / f"speaker_db_{stamp}.js").write_text(result,"utf-8")
    temp = DATA.with_suffix(".tmp")
    temp.write_text(result,"utf-8")
    temp.replace(DATA)
    write_index()
    print(dict(counts,total=len(rows),version=stamp))


if __name__ == "__main__":
    main()
