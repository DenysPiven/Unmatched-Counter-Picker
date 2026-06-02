# Unmatched Counter Pick

Mobile-friendly draft helper for **Unmatched** tournaments: 4 picks each, ban phases, and counter-pick suggestions from **UMLeague** stats on [Tabletop League](https://www.tabletopleague.com/games/unmatched/stats/characters).

## Run on your phone

```bash
cd /path/to/UnmatchedCounterPick
python3 -m http.server 8080
```

Open `http://<your-computer-ip>:8080` on the same Wi‑Fi network. Add to home screen in Safari for quick access.

## Usage

1. Choose who picks first.
2. **Draft** — tap a recommended hero or anyone in the grid. On opponent’s turn, tap their pick.
3. **Bans** — follow suggestions for banning their best matchup vs you, or your weakest vs them.
4. **Reset** — start a new match.

## Data

Stats live in CSV tables under `data/` (not JSON). Update from UMLeague:

```bash
python3 scripts/fetch-matchups.py
```

## Draft flow

1. Set **First pick** or **Second pick** (you).
2. **Draft** — alternating picks until each has 4 fighters.
3. **Bans** — opponent bans, secret self-ban, opponent bans again (per phase bar).

**Excluded** tab: check fighters to remove from the pool. **Defaults** = Sherlock, Elektra, Doctor Strange, Deadpool, Buffy, Angel, Spike, Willow.

Matchup data uses **only recorded league games** (`matchups.csv` + `plays.csv`). Fighter names, overall stats, and **Bradley-Terry tiers** are in `data/heroes.csv`.

Map pick / position are not in this app yet.
