#!/usr/bin/env python3
"""
Mirror real UMLeague data only — no estimated win rates.

matchups.csv:
  - Mirror win% from reverse when that side has recorded games
  - Remove win% cells with no recorded games for the pair

plays.csv:
  - Mirror game counts from reverse
"""

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIN_PATH = ROOT / "data" / "matchups.csv"
PLAYS_PATH = ROOT / "data" / "plays.csv"


def load_float_matrix(path: Path) -> tuple[list[str], dict[str, dict[str, float]]]:
    rows = list(csv.reader(path.open(encoding="utf-8")))
    cols = rows[0][1:]
    data: dict[str, dict[str, float]] = {}
    for row in rows[1:]:
        hero = row[0]
        data[hero] = {}
        for i, opp in enumerate(cols):
            j = i + 1
            if j < len(row) and row[j].strip():
                data[hero][opp] = float(row[j])
    return cols, data


def load_int_matrix(path: Path) -> tuple[list[str], dict[str, dict[str, int]]]:
    if not path.is_file():
        return [], {}
    rows = list(csv.reader(path.open(encoding="utf-8")))
    cols = rows[0][1:]
    data: dict[str, dict[str, int]] = {}
    for row in rows[1:]:
        hero = row[0]
        data[hero] = {}
        for i, opp in enumerate(cols):
            j = i + 1
            if j < len(row) and row[j].strip():
                data[hero][opp] = int(float(row[j]))
    return cols, data


def pair_plays(plays: dict, h: str, o: str) -> int:
    p = plays.get(h, {}).get(o)
    if p:
        return p
    return plays.get(o, {}).get(h) or 0


def write_float_matrix(path: Path, cols: list[str], data: dict) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([""] + cols)
        for hero in cols:
            row = [hero]
            for opp in cols:
                if hero == opp:
                    row.append("")
                else:
                    v = data.get(hero, {}).get(opp)
                    row.append("" if v is None else round(v, 1))
            w.writerow(row)


def write_int_matrix(path: Path, cols: list[str], data: dict) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([""] + cols)
        for hero in cols:
            row = [hero]
            for opp in cols:
                if hero == opp:
                    row.append("")
                else:
                    v = data.get(hero, {}).get(opp)
                    row.append("" if v is None else int(v))
            w.writerow(row)


def fill() -> None:
    cols, win = load_float_matrix(WIN_PATH)
    _, plays = load_int_matrix(PLAYS_PATH)
    for h in cols:
        win.setdefault(h, {})
        plays.setdefault(h, {})

    rev_win = 0
    rev_plays = 0
    pruned = 0

    for h in cols:
        for o in cols:
            if h == o:
                continue

            if plays[h].get(o) is None:
                back_p = plays.get(o, {}).get(h)
                if back_p is not None:
                    plays[h][o] = back_p
                    rev_plays += 1

            if win[h].get(o) is None:
                back = win.get(o, {}).get(h)
                if back is not None and pair_plays(plays, h, o) > 0:
                    win[h][o] = round(100 - back, 1)
                    rev_win += 1

    for h in cols:
        for o in cols:
            if h == o:
                continue
            if pair_plays(plays, h, o) <= 0 and win[h].get(o) is not None:
                del win[h][o]
                pruned += 1

    write_float_matrix(WIN_PATH, cols, win)
    write_int_matrix(PLAYS_PATH, cols, plays)
    print(f"Win% — mirror: {rev_win}, pruned (no games): {pruned}")
    print(f"Plays — mirror: {rev_plays}")


if __name__ == "__main__":
    fill()
