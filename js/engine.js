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

/** Single-number strength for pick/ban likelihood (0–1). */
export function heroStrength(hero, heroStats, tierList) {
  const bt = getHeroBT(hero, tierList);
  if (bt?.rate != null) return bt.rate;
  const overall = getHeroOverall(hero, heroStats);
  if (overall?.rate != null) return overall.rate;
  return 0.5;
}

/**
 * How likely each fighter is to be the one actually played / kept.
 * Stronger heroes get more weight (softmax on BT/overall).
 */
export function teamPickWeights(team, heroStats, tierList) {
  if (!team.length) return {};
  if (team.length === 1) return { [team[0]]: 1 };

  const strengths = team.map((h) => heroStrength(h, heroStats, tierList));
  const max = Math.max(...strengths);
  const exp = strengths.map((s) => Math.exp((s - max) * 8));
  const sum = exp.reduce((a, b) => a + b, 0);
  const weights = {};
  team.forEach((h, i) => {
    weights[h] = exp[i] / sum;
  });
  return weights;
}

/** Top *n* unpicked heroes the opponent is most likely to draft next. */
export function likelyPoolPicks(pool, heroStats, tierList, n = 3) {
  return [...pool]
    .sort(
      (a, b) =>
        heroStrength(b, heroStats, tierList) - heroStrength(a, heroStats, tierList)
    )
    .slice(0, Math.max(0, n));
}

/**
 * Opponent roster for scoring: known picks + a few likely future picks (draft).
 * @returns {{ roster: string[], weights: Record<string, number> }}
 */
export function opponentLikelyRoster(
  oppTeam,
  draftPool,
  heroStats,
  tierList,
  { maxFuture = 3, futureWeight = 0.35 } = {}
) {
  if (!oppTeam.length && !draftPool.length) {
    return { roster: [], weights: {} };
  }

  if (!draftPool.length) {
    return { roster: [...oppTeam], weights: teamPickWeights(oppTeam, heroStats, tierList) };
  }

  const future = likelyPoolPicks(draftPool, heroStats, tierList, maxFuture);
  const roster = [...new Set([...oppTeam, ...future])];
  const weights = teamPickWeights(roster, heroStats, tierList);
  for (const h of future) {
    weights[h] = (weights[h] ?? 0) * futureWeight;
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const h of roster) weights[h] /= sum;
  }
  return { roster, weights };
}

/**
 * Weighted Σ(win% × plays × pickWeight) / Σ(plays × pickWeight).
 * pickWeights: who on `team` is likely to be played / targeted (not equal average).
 */
export function scoreVsTeamWeighted(hero, team, matchups, plays, pickWeights = null) {
  if (!team.length) return { rate: null, games: 0 };

  const fallback =
    pickWeights ??
    Object.fromEntries(team.map((h) => [h, 1 / team.length]));

  let weighted = 0;
  let games = 0;
  for (const opp of team) {
    const p = getPlays(hero, opp, plays);
    if (p <= 0) continue;
    const rate = getWinRate(hero, opp, matchups, plays);
    if (rate == null) continue;
    const w = fallback[opp] ?? 1 / team.length;
    weighted += rate * p * w;
    games += p * w;
  }

  if (games > 0) {
    return { rate: weighted / games, games: Math.round(games) };
  }
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

/**
 * Who the score is weighted against (opponent picks, not the hero you might take).
 * @param {string} [excludeSlug] — drop from display/projection (current pick candidate)
 */
function formatLikelyTargets(
  roster,
  weights,
  { excludeSlug = null, oppTeam = [], labelHero = (s) => s, limit = 2 } = {}
) {
  const known = oppTeam.filter((h) => h !== excludeSlug);
  if (known.length) {
    const top = [...known]
      .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))
      .slice(0, limit)
      .filter((h) => (weights[h] ?? 0) > 0.08);
    if (top.length) {
      return `vs ${top.map(labelHero).join(", ")}`;
    }
  }

  const projected = roster.filter(
    (h) => h !== excludeSlug && !oppTeam.includes(h)
  );
  if (!projected.length) return "";

  const top = [...projected]
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))
    .slice(0, limit)
    .filter((h) => (weights[h] ?? 0) > 0.08);
  if (!top.length) return "";
  return `vs possible ${top.map(labelHero).join(", ")}`;
}

function formatReason(label, resolved, likelyNote = "") {
  if (resolved.rate == null) return `${label} — no league data`;
  const pct = Math.round(resolved.rate * 100);
  const bits = [];
  if (likelyNote) bits.push(likelyNote);
  if (resolved.tier && resolved.btRate != null) {
    bits.push(`${resolved.tier}-tier ${Math.round(resolved.btRate * 100)}% BT`);
  }
  if (resolved.overallRate != null) {
    bits.push(`${Math.round(resolved.overallRate * 100)}% overall`);
  }
  if (resolved.games > 0) {
    bits.push(`${Math.round(resolved.games)} matchup games`);
  }
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
  draftPool = [],
  actor = "me",
  labelHero = (slug) => slug,
  limit = RECOMMENDATION_LIMIT,
}) {
  const oppTurn = actor === "opp";

  const myWeights = teamPickWeights(myTeam, heroStats, tierList);
  const banPhaseOppRoster = opponentLikelyRoster(
    oppTeam,
    [],
    heroStats,
    tierList
  );

  const scored = available.map((hero) => {
    let label = "";
    let weighted = { rate: null, games: 0 };
    let vsRoster = false;
    let likelyNote = "";
    const likelyOpts = { labelHero, excludeSlug: hero };

    const oppRosterForPick = opponentLikelyRoster(
      oppTeam,
      draftPool.filter((h) => h !== hero),
      heroStats,
      tierList
    );

    switch (mode) {
      case "pick":
        if (oppTurn) {
          vsRoster = myTeam.length > 0;
          label = vsRoster ? "vs you" : "in pool";
          if (vsRoster) {
            weighted = scoreVsTeamWeighted(
              hero,
              myTeam,
              matchups,
              plays,
              myWeights
            );
            likelyNote = formatLikelyTargets(myTeam, myWeights, {
              ...likelyOpts,
              oppTeam: myTeam,
            });
          } else {
            weighted = overallStrengthWeighted(hero, allHeroes, matchups, plays);
          }
        } else {
          vsRoster = oppRosterForPick.roster.length > 0;
          label = vsRoster ? "vs them" : "in pool";
          if (vsRoster) {
            weighted = scoreVsTeamWeighted(
              hero,
              oppRosterForPick.roster,
              matchups,
              plays,
              oppRosterForPick.weights
            );
            likelyNote = formatLikelyTargets(
              oppRosterForPick.roster,
              oppRosterForPick.weights,
              { ...likelyOpts, oppTeam }
            );
          } else {
            weighted = overallStrengthWeighted(hero, allHeroes, matchups, plays);
          }
        }
        break;
      case "ban-opp":
        vsRoster = true;
        if (oppTurn) {
          label = "they may ban";
          weighted = scoreVsTeamWeighted(
            hero,
            banPhaseOppRoster.roster,
            matchups,
            plays,
            banPhaseOppRoster.weights
          );
          likelyNote = formatLikelyTargets(
            banPhaseOppRoster.roster,
            banPhaseOppRoster.weights,
            { ...likelyOpts, oppTeam }
          );
        } else {
          label = "ban their threat";
          weighted = scoreVsTeamWeighted(
            hero,
            myTeam,
            matchups,
            plays,
            myWeights
          );
          likelyNote = formatLikelyTargets(myTeam, myWeights, {
            ...likelyOpts,
            oppTeam: myTeam,
          });
        }
        break;
      case "ban-self":
        vsRoster = true;
        if (oppTurn) {
          label = "they may drop";
          weighted = scoreVsTeamWeighted(
            hero,
            banPhaseOppRoster.roster,
            matchups,
            plays,
            banPhaseOppRoster.weights
          );
          likelyNote = formatLikelyTargets(
            banPhaseOppRoster.roster,
            banPhaseOppRoster.weights,
            { ...likelyOpts, oppTeam }
          );
        } else {
          label = "your weakest";
          weighted = scoreVsTeamWeighted(
            hero,
            banPhaseOppRoster.roster,
            matchups,
            plays,
            banPhaseOppRoster.weights
          );
          likelyNote = formatLikelyTargets(
            banPhaseOppRoster.roster,
            banPhaseOppRoster.weights,
            { ...likelyOpts, oppTeam }
          );
        }
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
      reason: formatReason(label, resolved, likelyNote),
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
