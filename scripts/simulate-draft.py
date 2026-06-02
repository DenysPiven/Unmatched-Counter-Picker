#!/usr/bin/env python3
"""
Draft + ban simulation: system vs random opponent.
Matches app flow (PHASES): 4+4 draft, 4 public opp-bans, 2 secret self-bans.
"""

import csv
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from roster import OFFICIAL_SLUGS  # noqa: E402

DEFAULT_EXCLUDED = {
    "sherlock-holmes",
    "elektra",
    "doctor-strange",
    "deadpool",
    "buffy",
    "angel",
    "spike",
    "willow",
}

SIMULATIONS = 10_000

# Pick among top recommendations (rank-weighted), not always #1.
PICK_TOP_K = 5
BAN_TOP_K = 3

# Mirrors js/engine.js PHASES after draft
BAN_PHASES = [
    ("ban-opp", "follower"),
    ("ban-opp", "leader"),
    ("ban-self", None),
    ("ban-opp", "leader"),
    ("ban-opp", "follower"),
]


@dataclass
class MatchState:
    leader: str  # "me" | "opp"
    my_team: list[str] = field(default_factory=list)
    opp_team: list[str] = field(default_factory=list)
    my_bans: list[str] = field(default_factory=list)
    opp_bans: list[str] = field(default_factory=list)


def load_matrix(path: Path, *, pct: bool = False) -> tuple[list[str], dict]:
    rows = list(csv.reader(path.open(encoding="utf-8")))
    cols = rows[0][1:]
    data: dict = {}
    for row in rows[1:]:
        hero = row[0]
        data[hero] = {}
        for i, opp in enumerate(cols):
            if i + 1 < len(row) and row[i + 1].strip():
                v = float(row[i + 1])
                data[hero][opp] = v / 100 if pct else int(v)
    return cols, data


def load_heroes_table() -> tuple[dict, dict]:
    hero_stats: dict = {}
    tier: dict = {}
    for row in csv.DictReader((ROOT / "data" / "heroes.csv").open(encoding="utf-8")):
        slug = row["slug"]
        if row.get("win_pct") and row.get("plays"):
            hero_stats[slug] = {
                "winRate": float(row["win_pct"]) / 100,
                "totalPlays": int(row["plays"]),
            }
        if row.get("tier") and row.get("bt_pct") and row.get("bt_games"):
            games = int(row["bt_games"])
            if games >= 10:
                tier[slug] = {
                    "tier": row["tier"],
                    "bt": float(row["bt_pct"]) / 100,
                    "games": games,
                }
    return hero_stats, tier


def pair_plays(plays: dict, h: str, o: str) -> int:
    return plays.get(h, {}).get(o) or plays.get(o, {}).get(h) or 0


def get_wr(wr: dict, plays: dict, h: str, o: str) -> float | None:
    if pair_plays(plays, h, o) <= 0:
        return None
    v = wr.get(h, {}).get(o)
    if v is not None:
        return v
    rev = wr.get(o, {}).get(h)
    if rev is not None:
        return 1 - rev
    return None


def score_vs_team_weighted(
    hero: str, team: list[str], wr: dict, plays: dict
) -> tuple[float | None, int]:
    weighted = 0.0
    games = 0
    for opp in team:
        p = pair_plays(plays, hero, opp)
        if p <= 0:
            continue
        rate = get_wr(wr, plays, hero, opp)
        if rate is None:
            continue
        weighted += rate * p
        games += p
    if games > 0:
        return weighted / games, games
    return None, 0


def overall_strength(
    hero: str, pool: list[str], wr: dict, plays: dict
) -> tuple[float | None, int]:
    opps = [h for h in pool if h != hero]
    return score_vs_team_weighted(hero, opps, wr, plays)


def get_hero_bt(hero: str, tier: dict) -> dict | None:
    t = tier.get(hero)
    if not t or t["games"] < 10:
        return None
    return t


def resolve_score(
    matchup_rate: float | None,
    matchup_games: int,
    hero: str,
    hero_stats: dict,
    tier: dict,
    vs_roster: bool,
) -> float | None:
    bt = get_hero_bt(hero, tier)
    overall = hero_stats.get(hero)
    ov_rate = overall["winRate"] if overall else None

    if matchup_games > 0 and matchup_rate is not None:
        conf = min(1.0, matchup_games / (400 if vs_roster else 1200))
        w_matchup = (0.55 if vs_roster else 0.45) + 0.4 * conf
        rate = matchup_rate * w_matchup
        rem = 1 - w_matchup
        if rem > 0:
            if bt and ov_rate is not None:
                rate += rem * (0.55 * bt["bt"] + 0.45 * ov_rate)
            elif bt:
                rate += rem * bt["bt"]
            elif ov_rate is not None:
                rate += rem * ov_rate
        return rate

    if bt and ov_rate is not None:
        return 0.6 * bt["bt"] + 0.4 * ov_rate
    if bt:
        return bt["bt"]
    if ov_rate is not None:
        return ov_rate
    return None


def rank_heroes(
    candidates: list[str],
    my_team: list[str],
    opp_team: list[str],
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    mode: str,
) -> list[tuple[str, float]]:
    vs_roster = mode != "pick" or len(opp_team) > 0 or len(my_team) > 0
    scored: list[tuple[str, float]] = []

    for hero in candidates:
        if mode == "pick":
            if len(opp_team) > 0:
                m_rate, m_games = score_vs_team_weighted(hero, opp_team, wr, plays)
            else:
                m_rate, m_games = overall_strength(hero, pool, wr, plays)
        elif mode == "ban-opp":
            m_rate, m_games = score_vs_team_weighted(hero, my_team, wr, plays)
        else:  # ban-self
            m_rate, m_games = score_vs_team_weighted(hero, opp_team, wr, plays)

        if mode == "pick" and len(opp_team) == 0:
            vs_roster_flag = False
        else:
            vs_roster_flag = True

        score = resolve_score(
            m_rate,
            m_games,
            hero,
            hero_stats,
            tier,
            vs_roster_flag if mode == "pick" else True,
        )
        if score is not None:
            scored.append((hero, score))

    ascending = mode == "ban-self"
    scored.sort(key=lambda x: x[1], reverse=not ascending)
    return scored


def pick_from_top_k(
    ranked: list[tuple[str, float]], k: int, rng: random.Random
) -> str | None:
    """Rank-weighted random among top *k* ( #1 most likely, not guaranteed )."""
    if not ranked:
        return None
    short = ranked[: min(k, len(ranked))]
    if len(short) == 1:
        return short[0][0]
    weights = [len(short) - i for i in range(len(short))]
    heroes = [h for h, _ in short]
    return rng.choices(heroes, weights=weights, k=1)[0]


def system_choice(
    candidates: list[str],
    st: MatchState,
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    mode: str,
    rng: random.Random,
) -> str | None:
    ranked = rank_heroes(
        candidates, st.my_team, st.opp_team, pool, wr, plays, hero_stats, tier, mode
    )
    k = BAN_TOP_K if mode != "pick" else PICK_TOP_K
    return pick_from_top_k(ranked, k, rng)


def adversarial_choice(
    candidates: list[str],
    st: MatchState,
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    mode: str,
    rng: random.Random,
) -> str | None:
    """Opponent plays to hurt you: strong picks vs you, bans your best."""
    scored: list[tuple[str, float]] = []

    for hero in candidates:
        if mode == "pick":
            if st.my_team:
                m_rate, m_games = score_vs_team_weighted(hero, st.my_team, wr, plays)
                vs_roster = True
            else:
                m_rate, m_games = overall_strength(hero, pool, wr, plays)
                vs_roster = False
        elif mode == "ban-opp":
            m_rate, m_games = score_vs_team_weighted(hero, st.opp_team, wr, plays)
            vs_roster = True
        else:
            m_rate, m_games = score_vs_team_weighted(hero, st.my_team, wr, plays)
            vs_roster = True

        score = resolve_score(
            m_rate, m_games, hero, hero_stats, tier, vs_roster if mode == "pick" else True
        )
        if score is not None:
            scored.append((hero, score))

    if not scored:
        return None
    ascending = mode == "ban-self"
    scored.sort(key=lambda x: x[1], reverse=not ascending)
    k = BAN_TOP_K if mode != "pick" else PICK_TOP_K
    return pick_from_top_k(scored, k, rng)


def actor_choice(
    actor: str,
    candidates: list[str],
    st: MatchState,
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    mode: str,
    *,
    my_system: bool,
    opp_mode: str,
    rng: random.Random,
) -> str:
    if actor == "me" and my_system:
        pick = system_choice(
            candidates, st, pool, wr, plays, hero_stats, tier, mode, rng
        )
    elif actor == "opp" and opp_mode == "adversarial":
        pick = adversarial_choice(
            candidates, st, pool, wr, plays, hero_stats, tier, mode, rng
        )
    else:
        pick = None
    return pick if pick is not None else rng.choice(candidates)


def follower_of(leader: str) -> str:
    return "opp" if leader == "me" else "me"


def actor_for_ban_phase(role: str | None, leader: str) -> str:
    if role == "leader":
        return leader
    if role == "follower":
        return follower_of(leader)
    return "me"


def ban_pool(st: MatchState, actor: str, kind: str) -> list[str]:
    if kind == "ban-opp":
        if actor == "me":
            return [h for h in st.opp_team if h not in st.opp_bans]
        return [h for h in st.my_team if h not in st.my_bans]
    if actor == "me":
        return [h for h in st.my_team if h not in st.my_bans]
    return [h for h in st.opp_team if h not in st.opp_bans]


def draft_pool(st: MatchState, pool: list[str], wr: dict) -> list[str]:
    taken = set(st.my_team + st.opp_team + st.my_bans + st.opp_bans)
    return [h for h in pool if h not in taken and h in wr]


def active_roster(team: list[str], bans: list[str]) -> list[str]:
    return [h for h in team if h not in bans]


def team_expected_wr(
    my_team: list[str], opp_team: list[str], wr: dict, plays: dict
) -> tuple[float | None, int]:
    weighted = 0.0
    games = 0
    for h in my_team:
        for o in opp_team:
            p = pair_plays(plays, h, o)
            if p <= 0:
                continue
            rate = get_wr(wr, plays, h, o)
            if rate is None:
                continue
            weighted += rate * p
            games += p
    if games > 0:
        return weighted / games, games
    return None, 0


def run_draft_phase(
    rng: random.Random,
    st: MatchState,
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    *,
    my_system: bool,
    opp_mode: str,
) -> None:
    order = [
        st.leader if i % 2 == 0 else follower_of(st.leader) for i in range(8)
    ]
    for actor in order:
        available = draft_pool(st, pool, wr)
        if not available:
            break
        pick = actor_choice(
            actor,
            available,
            st,
            pool,
            wr,
            plays,
            hero_stats,
            tier,
            "pick",
            my_system=my_system,
            opp_mode=opp_mode,
            rng=rng,
        )
        if actor == "me":
            st.my_team.append(pick)
        else:
            st.opp_team.append(pick)


def apply_ban(
    st: MatchState, actor: str, slug: str, kind: str
) -> None:
    if kind == "ban-opp":
        if actor == "me":
            st.opp_bans.append(slug)
        else:
            st.my_bans.append(slug)
    elif actor == "me":
        st.my_bans.append(slug)
    else:
        st.opp_bans.append(slug)


def run_ban_phases(
    rng: random.Random,
    st: MatchState,
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    *,
    my_system: bool,
    opp_mode: str,
) -> None:
    for kind, role in BAN_PHASES:
        if kind == "ban-self":
            for actor in ("me", "opp"):
                candidates = ban_pool(st, actor, "ban-self")
                if not candidates:
                    continue
                pick = actor_choice(
                    actor,
                    candidates,
                    st,
                    pool,
                    wr,
                    plays,
                    hero_stats,
                    tier,
                    "ban-self",
                    my_system=my_system,
                    opp_mode=opp_mode,
                    rng=rng,
                )
                apply_ban(st, actor, pick, "ban-self")
            continue

        actor = actor_for_ban_phase(role, st.leader)
        candidates = ban_pool(st, actor, "ban-opp")
        if not candidates:
            continue
        pick = actor_choice(
            actor,
            candidates,
            st,
            pool,
            wr,
            plays,
            hero_stats,
            tier,
            "ban-opp",
            my_system=my_system,
            opp_mode=opp_mode,
            rng=rng,
        )
        apply_ban(st, actor, pick, "ban-opp")


def run_full_match(
    rng: random.Random,
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    *,
    leader: str,
    my_system: bool = True,
    opp_mode: str = "random",
) -> MatchState:
    st = MatchState(leader=leader)
    run_draft_phase(
        rng, st, pool, wr, plays, hero_stats, tier, my_system=my_system, opp_mode=opp_mode
    )
    run_ban_phases(
        rng, st, pool, wr, plays, hero_stats, tier, my_system=my_system, opp_mode=opp_mode
    )
    return st


def evaluate(st: MatchState, wr: dict, plays: dict) -> tuple[float | None, int, int, int]:
    my_active = active_roster(st.my_team, st.my_bans)
    opp_active = active_roster(st.opp_team, st.opp_bans)
    wr_val, games = team_expected_wr(my_active, opp_active, wr, plays)
    return wr_val, games, len(my_active), len(opp_active)


def run_simulation_batch(
    pool: list[str],
    wr: dict,
    plays: dict,
    hero_stats: dict,
    tier: dict,
    *,
    opp_mode: str,
    my_system: bool = True,
) -> dict[str, list[float]]:
    results = {
        "you_first": [],
        "you_second": [],
    }
    for i in range(SIMULATIONS):
        rng = random.Random(42 + i)
        leader = "me" if i % 2 == 0 else "opp"
        st = run_full_match(
            rng,
            pool,
            wr,
            plays,
            hero_stats,
            tier,
            leader=leader,
            my_system=my_system,
            opp_mode=opp_mode,
        )
        w, _ = evaluate(st, wr, plays)[:2]
        if w is not None:
            key = "you_first" if leader == "me" else "you_second"
            results[key].append(w)
    return results


def main() -> None:
    import sys

    opp_mode = "adversarial" if len(sys.argv) > 1 and sys.argv[1] == "adversarial" else "random"

    cols, wr = load_matrix(ROOT / "data" / "matchups.csv", pct=True)
    _, plays = load_matrix(ROOT / "data" / "plays.csv")
    hero_stats, tier = load_heroes_table()
    pool = [s for s in OFFICIAL_SLUGS if s not in DEFAULT_EXCLUDED]

    def avg(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    print("=" * 60)
    print("DRAFT + BAN SIMULATION REPORT")
    print("=" * 60)
    print(f"Simulations: {SIMULATIONS} (alternating first pick)")
    print(f"Pool: {len(pool)} fighters (default excluded: {len(DEFAULT_EXCLUDED)})")
    print("Flow: 4+4 draft → 4 ban-opp → 2 secret self-ban")
    print("You: engine recommendations")
    print(f"Pick noise: rank-weighted random among top {PICK_TOP_K} (bans: top {BAN_TOP_K})")
    if opp_mode == "adversarial":
        print("Opponent: adversarial (best pick vs you, ban your strongest)")
    else:
        print("Opponent: random picks & bans")
    print()
    print("Metric: weighted expected WR (recorded matchup games only)")
    print()

    sys_res = run_simulation_batch(
        pool, wr, plays, hero_stats, tier, opp_mode=opp_mode, my_system=True
    )
    sys_all = sys_res["you_first"] + sys_res["you_second"]

    for label, key in [
        ("You — pick 1st", "you_first"),
        ("You — pick 2nd", "you_second"),
    ]:
        xs = sys_res[key]
        print(f"  {label}: n={len(xs)}  avg WR = {avg(xs)*100:.2f}%")

    print()
    print(f"  COMBINED (system vs {opp_mode} opp): {avg(sys_all)*100:.2f}%  (n={len(sys_all)})")

    if opp_mode == "adversarial":
        print()
        print("-" * 60)
        print("COMPARISON vs random opponent (same seeds, paired)")
        rand_res = run_simulation_batch(
            pool, wr, plays, hero_stats, tier, opp_mode="random", my_system=True
        )
        rand_all = rand_res["you_first"] + rand_res["you_second"]

        paired_adv: list[float] = []
        paired_rand: list[float] = []
        for i in range(SIMULATIONS):
            rng = random.Random(42 + i)
            leader = "me" if i % 2 == 0 else "opp"
            st_a = run_full_match(
                rng, pool, wr, plays, hero_stats, tier,
                leader=leader, opp_mode="adversarial",
            )
            st_r = run_full_match(
                rng, pool, wr, plays, hero_stats, tier,
                leader=leader, opp_mode="random",
            )
            wa, _ = evaluate(st_a, wr, plays)[:2]
            wr_, _ = evaluate(st_r, wr, plays)[:2]
            if wa is not None and wr_ is not None:
                paired_adv.append(wa)
                paired_rand.append(wr_)

        print(f"  vs random opp:     {avg(rand_all)*100:.2f}%")
        print(f"  vs adversarial:    {avg(sys_all)*100:.2f}%")
        print(f"  Drop:              {(avg(sys_all) - avg(rand_all))*100:+.2f} pp")
        worse = sum(1 for a, r in zip(paired_adv, paired_rand) if a < r)
        print(f"  Adversarial hurts you in {worse}/{len(paired_adv)} drafts ({100*worse/len(paired_adv):.1f}%)")
        print(f"  Paired avg — random opp: {avg(paired_rand)*100:.2f}%  adversarial: {avg(paired_adv)*100:.2f}%")

    print()
    rng = random.Random(42)
    st = run_full_match(
        rng, pool, wr, plays, hero_stats, tier,
        leader="me", opp_mode=opp_mode,
    )
    w, g, *_ = evaluate(st, wr, plays)
    print(f"Example (you first, {opp_mode} opp):")
    print(f"  Draft you:  {', '.join(st.my_team)}")
    print(f"  Draft opp:  {', '.join(st.opp_team)}")
    print(f"  Bans on you:  {', '.join(st.my_bans) or '—'}")
    print(f"  Bans on opp:  {', '.join(st.opp_bans) or '—'}")
    print(f"  Active you:  {', '.join(active_roster(st.my_team, st.my_bans))}")
    print(f"  Active opp:  {', '.join(active_roster(st.opp_team, st.opp_bans))}")
    print(f"  Expected WR: {w*100:.1f}% ({g} weighted games)")


if __name__ == "__main__":
    # Default: adversarial opponent. Pass "random" for random-opponent run.
    if len(__import__("sys").argv) < 2:
        __import__("sys").argv.append("adversarial")
    main()
