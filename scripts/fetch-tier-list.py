#!/usr/bin/env python3
"""Fetch UMLeague Bradley-Terry tier list and merge into data/heroes.csv."""

import csv
import re
import subprocess
from pathlib import Path

TIER_PAGE = "https://www.tabletopleague.com/games/unmatched/stats/characters"
ROOT = Path(__file__).resolve().parents[1]
HEROES_PATH = ROOT / "data" / "heroes.csv"
MIN_BT_GAMES = 10

HERO_FIELDS = [
    "slug",
    "name",
    "win_pct",
    "plays",
    "rating_pct",
    "tier",
    "bt_pct",
    "bt_games",
]


def fetch(url: str) -> str:
    r = subprocess.run(
        ["curl", "-sL", url],
        capture_output=True,
        text=True,
        timeout=90,
        check=True,
    )
    return r.stdout


def parse_tier_list(html: str) -> dict[str, dict[str, float | int | str]]:
    """Parse tier sections from Next.js RSC payload (official slugs only)."""
    parts = re.split(r'\\"aria-label\\":\\"Tier ([A-Z]),', html)
    data: dict[str, dict[str, float | int | str]] = {}

    for i in range(1, len(parts), 2):
        tier = parts[i]
        body = parts[i + 1] if i + 1 < len(parts) else ""
        for m in re.finditer(r"/games/unmatched/stats/characters/([a-z0-9-]+)", body):
            slug = m.group(1)
            if "-alt-10" in slug:
                continue
            chunk = body[m.start() : m.start() + 400]
            stats = re.search(
                r"([\d.]+) percent expected win rate over (\d+) games", chunk
            )
            if not stats or slug in data:
                continue
            games = int(stats.group(2))
            if games < MIN_BT_GAMES:
                continue
            data[slug] = {
                "tier": tier,
                "bt_pct": float(stats.group(1)),
                "bt_games": games,
            }

    return data


def write_heroes_csv(
    path: Path,
    names: dict[str, str],
    overall: dict[str, tuple[int, float, float | None]],
    tier: dict[str, dict[str, float | int | str]],
    slugs: list[str],
) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HERO_FIELDS)
        for slug in slugs:
            plays, win_pct, rating = overall.get(slug, (0, 0.0, None))
            t = tier.get(slug, {})
            w.writerow(
                [
                    slug,
                    names.get(slug, slug.replace("-", " ").title()),
                    round(win_pct, 1) if plays else "",
                    plays if plays else "",
                    round(rating, 1) if rating is not None else "",
                    t.get("tier", ""),
                    t.get("bt_pct", ""),
                    t.get("bt_games", ""),
                ]
            )


def merge_tier_into_heroes(path: Path, tier: dict[str, dict]) -> int:
    """Update tier columns in an existing heroes.csv."""
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    if not rows:
        return 0
    updated = 0
    for row in rows:
        t = tier.get(row["slug"])
        if not t:
            row["tier"] = row.get("tier", "")
            row["bt_pct"] = row.get("bt_pct", "")
            row["bt_games"] = row.get("bt_games", "")
            continue
        row["tier"] = t["tier"]
        row["bt_pct"] = t["bt_pct"]
        row["bt_games"] = t["bt_games"]
        updated += 1
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HERO_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return updated


def fetch_tier_list(slugs: list[str] | None = None) -> int:
    import sys

    sys.path.insert(0, str(ROOT / "scripts"))
    from roster import OFFICIAL_SLUGS  # noqa: E402

    roster = list(slugs or OFFICIAL_SLUGS)
    html = fetch(TIER_PAGE)
    tier = parse_tier_list(html)
    HEROES_PATH.parent.mkdir(exist_ok=True)
    if HEROES_PATH.is_file():
        n = merge_tier_into_heroes(HEROES_PATH, tier)
        print(f"Updated tier columns in {HEROES_PATH} ({n}/{len(roster)} fighters)")
    else:
        names = {s: s.replace("-", " ").title() for s in roster}
        write_heroes_csv(HEROES_PATH, names, {}, tier, roster)
        print(f"Wrote {HEROES_PATH} ({len(tier)} with tier data)")
    return len(tier)


if __name__ == "__main__":
    fetch_tier_list()
