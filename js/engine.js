/** Win rate of `hero` vs `opponent` (0–1), or null if no recorded league games. */
export function getWinRate(hero, opponent, matchups, plays) {
  const p = getPlays(hero, opponent, plays);
  if (!plays || p <= 0) return null;

  const row = matchups[hero];
  if (row && row[opponent] != null) return row[opponent];
  const rev = matchups[opponent];
  if (rev && rev[hero] != null) return 1 - rev[hero];
  return null;
}

/** Recorded UMLeague games for this matchup (0 if unknown). */
export function getPlays(hero, opponent, plays) {
  if (!plays || !Object.keys(plays).length) return 0;
  const row = plays[hero];
  if (row && row[opponent] != null) return row[opponent];
  const rev = plays[opponent];
  if (rev && rev[hero] != null) return rev[hero];
  return 0;
}

/** Weighted Σ(win% × plays) / Σ(plays) — only pairs with recorded games. */
export function scoreVsTeamWeighted(hero, team, matchups, plays) {
  if (!team.length) return { rate: null, games: 0 };

  let weighted = 0;
  let games = 0;
  for (const opp of team) {
    const p = getPlays(hero, opp, plays);
    if (p <= 0) continue;
    const rate = getWinRate(hero, opp, matchups, plays);
    if (rate == null) continue;
    weighted += rate * p;
    games += p;
  }

  if (games > 0) return { rate: weighted / games, games };
  return { rate: null, games: 0 };
}

/** Weighted strength vs a pool (early draft). */
export function overallStrengthWeighted(hero, pool, matchups, plays) {
  const opponents = pool.filter((h) => h !== hero);
  return scoreVsTeamWeighted(hero, opponents, matchups, plays);
}

/** UMLeague overall win rate for this fighter (0–1), or null. */
export function getHeroOverall(hero, heroStats) {
  const s = heroStats?.[hero];
  if (!s || s.winRate == null || s.totalPlays <= 0) return null;
  return { rate: s.winRate, plays: s.totalPlays };
}

/** Tier priority multipliers on final pick score (UMLeague Bradley-Terry buckets). */
export const TIER_WEIGHT = {
  S: 1.15,
  A: 1.08,
  B: 1.0,
  C: 0.92,
  D: 0.72,
  F: 0.55,
};

/** Never recommend these tiers for your draft picks. */
export const TIERS_BLOCKED_FOR_PICK = new Set(["D", "F"]);

/** Bradley-Terry expected win % from UMLeague tier list (≥10 games). */
export function getHeroBT(hero, tierList) {
  const t = tierList?.[hero];
  if (!t || t.games < 10 || t.bt == null) return null;
  return { rate: t.bt, tier: t.tier, games: t.games };
}

/** Apply tier priority; block D/F for your draft picks. */
export function applyTierPriority(resolved, { mode, forUserPick }) {
  if (resolved.rate == null) return resolved;

  const tier = resolved.tier;
  if (forUserPick && mode === "pick" && tier && TIERS_BLOCKED_FOR_PICK.has(tier)) {
    return { ...resolved, rate: null };
  }

  if (!tier || TIER_WEIGHT[tier] == null) return resolved;

  return { ...resolved, rate: resolved.rate * TIER_WEIGHT[tier] };
}

/**
 * Blend matchup sample, Bradley-Terry tier strength, and overall league WR.
 * @param {boolean} vsRoster — scoring vs known picks (matchups weigh more)
 */
export function resolveScore(
  matchupRate,
  matchupGames,
  hero,
  heroStats,
  tierList,
  vsRoster = false
) {
  const bt = getHeroBT(hero, tierList);
  const overall = getHeroOverall(hero, heroStats);

  if (matchupGames > 0 && matchupRate != null) {
    const conf = Math.min(1, matchupGames / (vsRoster ? 400 : 1200));
    const wMatchup = (vsRoster ? 0.55 : 0.45) + 0.4 * conf;
    let rate = matchupRate * wMatchup;
    const rem = 1 - wMatchup;
    if (rem > 0) {
      if (bt && overall) rate += rem * (0.65 * bt.rate + 0.35 * overall.rate);
      else if (bt) rate += rem * bt.rate;
      else if (overall) rate += rem * overall.rate;
    }
    return {
      rate,
      games: matchupGames,
      overallRate: overall?.rate ?? null,
      btRate: bt?.rate ?? null,
      tier: bt?.tier ?? null,
    };
  }

  if (bt && overall) {
    return {
      rate: 0.72 * bt.rate + 0.28 * overall.rate,
      games: 0,
      overallRate: overall.rate,
      btRate: bt.rate,
      tier: bt.tier,
    };
  }
  if (bt) {
    return {
      rate: bt.rate,
      games: 0,
      overallRate: null,
      btRate: bt.rate,
      tier: bt.tier,
    };
  }
  if (overall) {
    return {
      rate: overall.rate,
      games: 0,
      overallRate: overall.rate,
      btRate: null,
      tier: null,
    };
  }

  return { rate: null, games: 0, overallRate: null, btRate: null, tier: null };
}

function formatReason(label, resolved) {
  if (resolved.rate == null) return `${label} — no league data`;
  const pct = Math.round(resolved.rate * 100);
  const bits = [];
  if (resolved.tier && resolved.btRate != null) {
    bits.push(`${resolved.tier}-tier ${Math.round(resolved.btRate * 100)}% BT`);
  }
  if (resolved.overallRate != null) {
    bits.push(`${Math.round(resolved.overallRate * 100)}% overall`);
  }
  if (resolved.games > 0) bits.push(`${resolved.games} matchup games`);
  if (bits.length) return `${label} ~${pct}% (${bits.join(" · ")})`;
  return `${label} ~${pct}%`;
}

export const RECOMMENDATION_LIMIT = 10;

export function getRecommendations({
  available,
  myTeam,
  oppTeam,
  mode,
  matchups,
  plays = {},
  heroStats = {},
  tierList = {},
  allHeroes,
  actor = "me",
  limit = RECOMMENDATION_LIMIT,
}) {
  const oppTurn = actor === "opp";

  const scored = available.map((hero) => {
    let label = "";
    let weighted = { rate: null, games: 0 };
    let vsRoster = false;

    switch (mode) {
      case "pick":
        if (oppTurn) {
          vsRoster = myTeam.length > 0;
          label = vsRoster ? "vs you" : "in pool";
          weighted = vsRoster
            ? scoreVsTeamWeighted(hero, myTeam, matchups, plays)
            : overallStrengthWeighted(hero, allHeroes, matchups, plays);
        } else {
          vsRoster = oppTeam.length > 0;
          label = vsRoster ? "vs them" : "in pool";
          weighted = vsRoster
            ? scoreVsTeamWeighted(hero, oppTeam, matchups, plays)
            : overallStrengthWeighted(hero, allHeroes, matchups, plays);
        }
        break;
      case "ban-opp":
        vsRoster = true;
        label = oppTurn ? "they may ban" : "ban their best";
        weighted = scoreVsTeamWeighted(
          hero,
          oppTurn ? oppTeam : myTeam,
          matchups,
          plays
        );
        break;
      case "ban-self":
        vsRoster = true;
        label = oppTurn ? "they may drop" : "your weakest";
        weighted = scoreVsTeamWeighted(
          hero,
          oppTurn ? myTeam : oppTeam,
          matchups,
          plays
        );
        break;
      default:
        return { hero, score: null, reason: "", games: 0 };
    }

    const resolved = applyTierPriority(
      resolveScore(
        weighted.rate,
        weighted.games,
        hero,
        heroStats,
        tierList,
        vsRoster
      ),
      {
        mode,
        forUserPick: !oppTurn,
      }
    );
    return {
      hero,
      score: resolved.rate,
      reason: formatReason(label, resolved),
      games: resolved.games,
    };
  });

  const useAsc = mode === "ban-self";
  scored.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return useAsc ? a.score - b.score : b.score - a.score;
  });

  const withData = scored.filter((s) => s.score != null);
  return withData.slice(0, limit);
}

/** Draft/ban flow (first → second alternating picks). */
export const PHASES = [
  { id: "draft", label: "Draft", kind: "draft" },
  { id: "ban-opp-f1", label: "Ban opponent", kind: "ban-opp", role: "follower" },
  { id: "ban-opp-l1", label: "Ban opponent", kind: "ban-opp", role: "leader" },
  { id: "ban-self-secret", label: "Secret self-ban", kind: "ban-self", secret: true },
  { id: "ban-opp-l2", label: "Ban opponent", kind: "ban-opp", role: "leader" },
  { id: "ban-opp-f2", label: "Ban opponent", kind: "ban-opp", role: "follower" },
];

export function followerOf(leader) {
  return leader === "me" ? "opp" : "me";
}

export function draftTurnOrder(leader) {
  const follower = followerOf(leader);
  const order = [];
  for (let i = 0; i < 8; i++) {
    order.push(i % 2 === 0 ? leader : follower);
  }
  return order;
}

export function actorForPhase(phase, leader) {
  if (phase.kind === "draft") return null;
  if (phase.kind === "ban-self") return null;
  if (phase.role === "leader") return leader;
  if (phase.role === "follower") return followerOf(leader);
  return null;
}

export function roleLabel(role, leader) {
  const isMeLeader = leader === "me";
  if (role === "leader") return isMeLeader ? "First (you)" : "First (opp)";
  if (role === "follower") return isMeLeader ? "Second (opp)" : "Second (you)";
  return role;
}
