import { loadMatchupData } from "./load-data.js";
import {
  getRecommendations,
  PHASES,
  draftTurnOrder,
  actorForPhase,
  roleLabel,
} from "./engine.js";
import {
  loadExcluded,
  isExcluded,
  setExcluded,
  resetExcludedToDefault,
  clearExcluded,
  getExcluded,
} from "./pool.js";
const STORAGE_KEY = "unmatched-draft-v2";

let HERO_NAMES = {};
let MATCHUPS = {};
let MATCHUP_PLAYS = {};
let HERO_STATS = {};
let TIER_LIST = {};

const state = {
  phaseIndex: 0,
  stepIndex: 0,
  leader: "me",
  myTeam: [],
  oppTeam: [],
  myBans: [],
  oppBans: [],
  mySecretBan: null,
  oppSecretBan: null,
};

let draftOrder = [];

const $ = (sel) => document.querySelector(sel);

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    Object.assign(state, JSON.parse(raw));
  } catch {
    /* ignore */
  }
}

function allHeroSlugs() {
  return Object.keys(HERO_NAMES).filter((s) => !s.includes("-alt-10"));
}

/** Fighters in the active pool (draft / bans / recommendations). */
function activePoolSlugs() {
  return allHeroSlugs().filter((s) => !isExcluded(s));
}

function heroLabel(slug) {
  return HERO_NAMES[slug] || slug;
}

function currentPhase() {
  return PHASES[state.phaseIndex] || PHASES[PHASES.length - 1];
}

function isDraftPhase() {
  return currentPhase().kind === "draft";
}

function isSecretSelfBanPhase() {
  return currentPhase().id === "ban-self-secret";
}

function activePlayer() {
  const phase = currentPhase();
  if (isDraftPhase()) return draftOrder[state.stepIndex] || "me";
  if (isSecretSelfBanPhase()) {
    if (state.stepIndex === 0) return "me";
    if (state.stepIndex === 1) return "opp";
    return null;
  }
  return actorForPhase(phase, state.leader);
}

function availablePool() {
  const taken = new Set([
    ...state.myTeam,
    ...state.oppTeam,
    ...state.myBans,
    ...state.oppBans,
  ]);
  return activePoolSlugs().filter((h) => !taken.has(h) && MATCHUPS[h]);
}

function banPoolFor(actor) {
  const phase = currentPhase();
  if (phase.kind === "ban-opp") {
    if (actor === "me") {
      return state.oppTeam.filter((h) => !state.oppBans.includes(h));
    }
    return state.myTeam.filter((h) => !state.myBans.includes(h));
  }
  if (actor === "me") {
    return state.myTeam.filter((h) => !state.myBans.includes(h));
  }
  return state.oppTeam.filter((h) => !state.oppBans.includes(h));
}

function banPool() {
  const actor = activePlayer();
  if (!actor) return [];
  return banPoolFor(actor);
}

function recommendationMode() {
  const phase = currentPhase();
  if (phase.kind === "draft") return "pick";
  if (phase.kind === "ban-opp") return "ban-opp";
  return "ban-self";
}

function canAct() {
  return activePlayer() === "me";
}

function nextStep() {
  const phase = currentPhase();

  if (isDraftPhase()) {
    state.stepIndex++;
    if (state.stepIndex >= 8) {
      state.phaseIndex = 1;
      state.stepIndex = 0;
    }
    return;
  }

  if (isSecretSelfBanPhase()) {
    state.stepIndex++;
    if (state.stepIndex >= 2) {
      state.phaseIndex++;
      state.stepIndex = 0;
    }
    return;
  }

  state.phaseIndex++;
  state.stepIndex = 0;
}

function recordOpponentAction(slug) {
  if (isDraftPhase()) {
    state.oppTeam.push(slug);
  } else if (isSecretSelfBanPhase()) {
    state.oppSecretBan = slug;
    state.oppBans.push(slug);
  } else if (currentPhase().kind === "ban-opp") {
    state.myBans.push(slug);
  }
  nextStep();
  save();
  render();
}

function recordMyAction(slug) {
  if (isDraftPhase()) {
    state.myTeam.push(slug);
  } else if (isSecretSelfBanPhase()) {
    state.mySecretBan = slug;
    state.myBans.push(slug);
  } else if (currentPhase().kind === "ban-opp") {
    state.oppBans.push(slug);
  }
  nextStep();
  save();
  render();
}

function resetAll() {
  state.phaseIndex = 0;
  state.stepIndex = 0;
  state.myTeam = [];
  state.oppTeam = [];
  state.myBans = [];
  state.oppBans = [];
  state.mySecretBan = null;
  state.oppSecretBan = null;
  draftOrder = draftTurnOrder(state.leader);
  save();
  render();
}

function renderPhaseBar() {
  const phase = currentPhase();
  const player = activePlayer();
  let hint = phase.label;

  if (isDraftPhase()) {
    const pickNum = state.stepIndex + 1;
    const who = draftOrder[state.stepIndex];
    const role =
      who === state.leader
        ? roleLabel("leader", state.leader)
        : roleLabel("follower", state.leader);
    hint = `Draft · pick ${pickNum}/8 · ${role}`;
  } else if (isSecretSelfBanPhase()) {
    if (state.stepIndex === 0) {
      hint = "Secret self-ban · choose yours (hide screen)";
    } else {
      hint = "Secret self-ban · record opponent's ban";
    }
  } else if (phase.role) {
    hint += ` · ${roleLabel(phase.role, state.leader)}`;
  }

  if (player === "me") hint += " · your turn";
  else if (player === "opp") hint += " · opponent's turn";
  else if (state.phaseIndex >= PHASES.length) hint = "Draft complete";

  $("#phase-label").textContent = hint;
}

function renderTeams() {
  const fmt = (arr, bans) => {
    const active = arr.filter((h) => !bans.includes(h));
    return active.map(heroLabel).join(", ") || "—";
  };
  $("#my-team").textContent = fmt(state.myTeam, state.myBans);
  $("#opp-team").textContent = fmt(state.oppTeam, state.oppBans);

  const myBanLabels = state.myBans.map(heroLabel);
  const oppBanLabels = state.oppBans.map(heroLabel);
  $("#my-bans").textContent = myBanLabels.join(", ") || "—";
  $("#opp-bans").textContent = oppBanLabels.join(", ") || "—";

  const secretEl = $("#secret-status");
  if (secretEl) {
    const parts = [];
    if (state.mySecretBan) parts.push(`You: ${heroLabel(state.mySecretBan)}`);
    if (state.oppSecretBan) parts.push(`Opp: ${heroLabel(state.oppSecretBan)}`);
    secretEl.textContent = parts.length ? parts.join(" · ") : "—";
    secretEl.hidden = !state.mySecretBan && !state.oppSecretBan;
  }
}

function renderRecommendations() {
  const list = $("#rec-list");
  list.innerHTML = "";

  if (state.phaseIndex >= PHASES.length) {
    list.innerHTML = '<li class="rec-muted">All picks and bans done. Play your remaining fighter.</li>';
    return;
  }

  const actor = activePlayer();
  if (!actor) return;

  const mode = recommendationMode();
  const pool = isDraftPhase() ? availablePool() : banPoolFor(actor);

  if (!pool.length) {
    list.innerHTML = '<li class="rec-muted">No heroes available for this step.</li>';
    return;
  }

  const oppTurn = actor === "opp";
  const heading = document.createElement("li");
  heading.className = "rec-heading";
  heading.textContent = oppTurn
    ? "Opponent's turn — likely choices:"
    : "Your turn — best options:";
  list.appendChild(heading);

  const recs = getRecommendations({
    available: pool,
    myTeam: state.myTeam.filter((h) => !state.myBans.includes(h)),
    oppTeam: state.oppTeam.filter((h) => !state.oppBans.includes(h)),
    mode,
    matchups: MATCHUPS,
    plays: MATCHUP_PLAYS,
    heroStats: HERO_STATS,
    tierList: TIER_LIST,
    allHeroes: activePoolSlugs(),
    actor,
  });

  recs.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "rec-item";
    li.innerHTML = `<span class="rec-rank">${i + 1}</span><span class="rec-name">${heroLabel(r.hero)}</span><span class="rec-reason">${r.reason}</span>`;
    li.addEventListener("click", () => selectHero(r.hero));
    list.appendChild(li);
  });
}

function renderHeroGrid() {
  const grid = $("#hero-grid");
  grid.innerHTML = "";

  if (state.phaseIndex >= PHASES.length) return;

  const actor = activePlayer();
  const pool = isDraftPhase() ? availablePool() : actor ? banPoolFor(actor) : [];
  const sorted = [...pool].sort((a, b) =>
    heroLabel(a).localeCompare(heroLabel(b), "en")
  );

  sorted.forEach((slug) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero-btn";
    btn.textContent = heroLabel(slug);
    btn.addEventListener("click", () => selectHero(slug));
    grid.appendChild(btn);
  });
}

function selectHero(slug) {
  if (canAct()) recordMyAction(slug);
  else recordOpponentAction(slug);
}

function renderPoolTab() {
  const list = $("#pool-list");
  if (!list) return;
  list.innerHTML = "";

  const excluded = getExcluded();
  const sorted = [...allHeroSlugs()].sort((a, b) =>
    heroLabel(a).localeCompare(heroLabel(b), "en")
  );

  sorted.forEach((slug) => {
    const label = document.createElement("label");
    label.className = "pool-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isExcluded(slug);
    cb.addEventListener("change", () => {
      setExcluded(slug, cb.checked);
      renderPoolTab();
      render();
    });
    const name = document.createElement("span");
    name.textContent = heroLabel(slug);
    label.appendChild(cb);
    label.appendChild(name);
    list.appendChild(label);
  });

  const count = $("#pool-count");
  if (count) {
    count.textContent = `${excluded.size} excluded · ${activePoolSlugs().length} in pool`;
  }
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });
      $("#panel-draft").hidden = tab !== "draft";
      $("#panel-pool").hidden = tab !== "pool";
    });
  });

  $("#btn-pool-default")?.addEventListener("click", () => {
    resetExcludedToDefault();
    renderPoolTab();
    render();
  });

  $("#btn-pool-all")?.addEventListener("click", () => {
    clearExcluded();
    renderPoolTab();
    render();
  });
}

function bindUi() {
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("Reset the whole draft?")) resetAll();
  });

  $("#leader-role").addEventListener("change", (e) => {
    if (state.myTeam.length || state.oppTeam.length) {
      if (!confirm("Changing role resets the draft. Continue?")) {
        e.target.value = state.leader;
        return;
      }
    }
    state.leader = e.target.value;
    draftOrder = draftTurnOrder(state.leader);
    resetAll();
  });

  $("#leader-role").value = state.leader;

  $("#search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".hero-btn").forEach((btn) => {
      btn.hidden = q && !btn.textContent.toLowerCase().includes(q);
    });
  });

  $("#pool-search")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".pool-row").forEach((row) => {
      row.hidden = q && !row.textContent.toLowerCase().includes(q);
    });
  });
}

function render() {
  renderPhaseBar();
  renderTeams();
  renderRecommendations();
  renderHeroGrid();
}

async function init() {
  try {
    const data = await loadMatchupData();
    HERO_NAMES = data.heroes;
    MATCHUPS = data.matchups;
    MATCHUP_PLAYS = data.plays || {};
    HERO_STATS = data.heroStats || {};
    TIER_LIST = data.tierList || {};
  } catch (err) {
    $("#phase-label").textContent = `Failed to load data: ${err.message}`;
    return;
  }

  loadExcluded();
  load();
  if (!state.leader) state.leader = "me";
  draftOrder = draftTurnOrder(state.leader);
  bindTabs();
  bindUi();
  renderPoolTab();
  render();
}

init();
