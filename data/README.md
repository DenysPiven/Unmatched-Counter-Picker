# Matchup tables (UMLeague)

| File | Description |
|------|-------------|
| `heroes.csv` | **74 fighters** — name, overall league stats, Bradley-Terry tier |
| `matchups.csv` | **74×74 matrix** — win % only where league games exist |
| `plays.csv` | **74×74 matrix** — game counts per matchup (weights recommendations) |
| `SOURCE.txt` | Source and last update |

### `heroes.csv` columns

| Column | Description |
|--------|-------------|
| `slug` | Fighter id |
| `name` | Display name |
| `win_pct` | Overall league win % |
| `plays` | Total league games |
| `rating_pct` | UMLeague rating |
| `tier` | Bradley-Terry bucket (S, A, B, C, D, F) |
| `bt_pct` | Bradley-Terry expected win % |
| `bt_games` | Games used for tier ranking |

Matrix layout (matchups / plays):

```csv
,achilles,medusa,bigfoot
achilles,,65.8,48.1
medusa,34.2,,66.0
```

Cell `medusa,bigfoot` = Medusa’s win % vs Bigfoot. Empty = no recorded games.

## Recommendations

- **Matchups** — only pairs with recorded games in `plays.csv` (weighted by game count).
- **Early pool** — blends **Bradley-Terry** (`bt_pct`, `tier`) with **overall win %** from the same `heroes.csv` row.
- **Vs known roster** — real matchup win % dominates; tier/overall are tie-breakers.
- **No 50/50 placeholders** — unknown matchups are not used.

`scripts/fill-matchups.py` only **mirrors** real data and removes win % without games.

Refresh from [Tabletop League](https://www.tabletopleague.com/games/unmatched/stats/characters):

```bash
python3 scripts/fetch-matchups.py
python3 scripts/fetch-tier-list.py   # tier columns only (~1s)
```

Alt 1.0 variants (`*-alt-10`) are omitted from the fetch.

Excluded fighters are configured in the app under **Excluded**, not in these files.
