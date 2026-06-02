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

BT_ARIA = re.compile(
    r'characters/([a-z0-9-]+)\\",\\"aria-label\\":\\"[^"]+: '
    r"([\d.]+) percent expected win rate over (\d+) games\\\""
)

# First fighter in each tier group inside the Tier F section chunk (stream order).
BF_TIER_STARTS = (
    ("george-washington", "F"),
    ("she-hulk", "B"),
    ("wyatt-earp", "C"),
    ("bruce-lee", "B"),
    ("pandora", "C"),
    ("buffy", "D"),
)


def fetch(url: str) -> str:
    r = subprocess.run(
        ["curl", "-sL", url],
        capture_output=True,
        text=True,
        timeout=90,
        check=True,
    )
    return r.stdout


def _section_bounds(html: str, letter: str, next_letter: str) -> tuple[int, int]:
    start_pat = rf'\\"section\\",\\"{letter}\\",\{{\\"aria-label\\":\\"Tier {letter},'
    next_pat = rf'\\"section\\",\\"{next_letter}\\",\{{\\"aria-label\\":\\"Tier {next_letter},'
    m = re.search(start_pat, html)
    if not m:
        return 0, 0
    m2 = re.search(next_pat, html[m.end() :])
    end = m.end() + m2.start() if m2 else m.end() + 20_000
    return m.start(), end


def _parse_bt_entries(html: str, start: int, end: int) -> list[tuple[str, float, int, int]]:
    """Return (slug, bt_pct, bt_games, position) within [start, end)."""
    out: list[tuple[str, float, int, int]] = []
    for m in BT_ARIA.finditer(html[start:end]):
        slug = m.group(1)
        games = int(m.group(3))
        if games < MIN_BT_GAMES or "-alt-10" in slug:
            continue
        out.append((slug, float(m.group(2)), games, start + m.start()))
    return out


def _chunk_bounds(html: str, start_key: str, end_key: str) -> tuple[int, int]:
    s = html.find(start_key)
    e = html.find(end_key, s)
    return s, e if e != -1 else s + 120_000


def _parse_bf_chunk_tiers(f_chunk: str) -> dict[str, dict[str, float | int | str]]:
    """Assign tiers for fighters listed in the Tier F section chunk."""
    out: dict[str, dict[str, float | int | str]] = {}
    current_tier = "F"
    transitions = dict(BF_TIER_STARTS)

    for m in BT_ARIA.finditer(f_chunk):
        slug = m.group(1)
        games = int(m.group(3))
        if games < MIN_BT_GAMES or "-alt-10" in slug:
            continue
        if slug in transitions:
            current_tier = transitions[slug]
        out[slug] = {
            "tier": current_tier,
            "bt_pct": float(m.group(2)),
            "bt_games": games,
        }

    return out


def parse_tier_list(html: str) -> dict[str, dict[str, float | int | str]]:
    """Parse tier + Bradley-Terry stats from Tabletop League tier list page."""
    data: dict[str, dict[str, float | int | str]] = {}

    for letter, nxt in (("S", "A"), ("A", "B")):
        s, e = _section_bounds(html, letter, nxt)
        for slug, pct, games, _ in _parse_bt_entries(html, s, e):
            data[slug] = {"tier": letter, "bt_pct": pct, "bt_games": games}

    for letter, start_key, end_key in (
        ("B", '[1,"bc:', '[1,"bd:'),
        ("C", '[1,"bd:', '[1,"be:'),
        ("D", '[1,"be:', '[1,"bf:'),
    ):
        s, e = _chunk_bounds(html, start_key, end_key)
        for slug, pct, games, _ in _parse_bt_entries(html, s, e):
            data[slug] = {"tier": letter, "bt_pct": pct, "bt_games": games}

    # Remaining fighters live in the Tier F section chunk (multi-column masonry).
    f_start = html.find('[1,"bf:')
    f_end = html.find('[1,"bg:', f_start)
    if f_end == -1:
        f_end = f_start + 120_000
    f_chunk = html[f_start:f_end]

    bf_data = _parse_bf_chunk_tiers(f_chunk)
    for slug, entry in bf_data.items():
        if slug not in data:
            data[slug] = entry

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
