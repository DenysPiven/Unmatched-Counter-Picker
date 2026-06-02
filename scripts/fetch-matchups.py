#!/usr/bin/env python3
"""Download UMLeague matchup stats from Tabletop League into data/*.csv."""

import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

BASE = "https://www.tabletopleague.com/games/unmatched/stats/characters"
ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "scripts"))
from roster import OFFICIAL_SLUGS  # noqa: E402

ENTRY_RE = re.compile(
    r'\\"wins\\":(\d+),\\"plays\\":(\d+),\\"losses\\":(\d+).*?'
    r'\\"opponent_name\\":\\"([^"\\]+)\\",\\"opponent_slug\\":\\"([a-z0-9-]+)\\"'
)
OVERALL_RE = re.compile(
    r">([\d,]+)</p><p class=\"text-sm text-muted-foreground\">Plays</p></div><div>"
    r"<p class=\"text-2xl font-bold[^\"]*\">([\d.]+)%</p>"
    r"<p class=\"text-sm text-muted-foreground\">Win Rate</p></div><div>"
    r"<p class=\"text-2xl font-bold[^\"]*\">([\d.]+)%</p>"
    r"<p class=\"text-sm text-muted-foreground\">Rating"
)


def is_alt_slug(slug: str) -> bool:
    return "-alt-10" in slug


def fetch(url: str) -> str:
    r = subprocess.run(
        ["curl", "-sL", url],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return r.stdout


def write_int_matrix(
    path: Path,
    data: dict[str, dict[str, int]],
    slugs: list[str],
    *,
    as_pct: bool = False,
) -> None:
    import csv

    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([""] + slugs)
        for hero in slugs:
            row = [hero]
            for opp in slugs:
                if hero == opp:
                    row.append("")
                    continue
                v = data.get(hero, {}).get(opp)
                if v is None:
                    row.append("")
                elif as_pct:
                    row.append(round(v * 100, 1))
                else:
                    row.append(int(v))
            w.writerow(row)


def main() -> None:
    from fetch_tier_list import fetch, parse_tier_list, write_heroes_csv  # noqa: E402

    slugs = list(OFFICIAL_SLUGS)
    official_set = set(slugs)
    print(f"Official roster: {len(slugs)} fighters")

    win_rates: dict[str, dict[str, float]] = {}
    play_counts: dict[str, dict[str, int]] = {}
    overall: dict[str, tuple[int, float, float | None]] = {}
    names: dict[str, str] = {}

    for i, slug in enumerate(slugs):
        page = fetch(f"{BASE}/{slug}")
        om = OVERALL_RE.search(page)
        if om:
            total_plays = int(om.group(1).replace(",", ""))
            win_pct = float(om.group(2))
            rating = float(om.group(3))
            overall[slug] = (total_plays, win_pct, rating)
        entries = ENTRY_RE.findall(page)
        hero_wr: dict[str, float] = {}
        hero_plays: dict[str, int] = {}
        for wins, plays, _losses, opp_name, opp_slug in entries:
            if is_alt_slug(opp_slug) or opp_slug not in official_set:
                continue
            plays_i = int(plays)
            if plays_i:
                hero_plays[opp_slug] = plays_i
                hero_wr[opp_slug] = round(int(wins) / plays_i, 4)
                names[opp_slug] = opp_name
        win_rates[slug] = hero_wr
        play_counts[slug] = hero_plays
        nm = re.search(r"# ([^\n<]+)", page)
        names[slug] = nm.group(1).strip() if nm else slug.replace("-", " ").title()
        if (i + 1) % 15 == 0:
            print(f"  {i + 1}/{len(slugs)}")
        time.sleep(0.08)

    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)

    print("Fetching tier list…")
    tier_html = fetch(
        "https://www.tabletopleague.com/games/unmatched/stats/characters"
    )
    tier = parse_tier_list(tier_html)

    write_heroes_csv(data_dir / "heroes.csv", names, overall, tier, slugs)
    write_int_matrix(data_dir / "matchups.csv", win_rates, slugs, as_pct=True)
    write_int_matrix(data_dir / "plays.csv", play_counts, slugs)

    meta = data_dir / "SOURCE.txt"
    meta.write_text(
        f"Source: Tabletop League / UMLeague\n"
        f"URL: {BASE}\n"
        f"Updated: {date.today().isoformat()}\n"
        f"heroes.csv — names, overall stats, Bradley-Terry tier\n"
        f"matchups.csv — win % (row vs column)\n"
        f"plays.csv — recorded games per matchup (for weighted stats)\n",
        encoding="utf-8",
    )
    print(f"Wrote {data_dir / 'heroes.csv'} ({len(tier)} with tier data)")
    print(f"Wrote {data_dir / 'matchups.csv'} ({len(slugs)}x{len(slugs)})")
    print(f"Wrote {data_dir / 'plays.csv'}")


if __name__ == "__main__":
    main()
    import runpy

    runpy.run_path(str(ROOT / "scripts" / "fill-matchups.py"), run_name="__main__")
