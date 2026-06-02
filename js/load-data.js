/** Load UMLeague tables: heroes.csv, matchups.csv, plays.csv. */

function parseCsvLine(line) {
  const parts = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    rows.push(parseCsvLine(line));
  }
  return rows;
}

function parseMatrix(rows, parser) {
  if (rows.length < 2) return {};
  const header = rows[0];
  const colSlugs = header.slice(1).filter(Boolean);
  const out = {};

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const hero = row[0];
    if (!hero) continue;
    out[hero] = {};
    for (let c = 1; c < row.length && c - 1 < colSlugs.length; c++) {
      const opp = colSlugs[c - 1];
      const cell = row[c];
      if (!opp || cell === "" || hero === opp) continue;
      const val = parser(cell);
      if (val != null) out[hero][opp] = val;
    }
  }
  return out;
}

function num(cell) {
  const n = Number(cell);
  return Number.isNaN(n) ? null : n;
}

/** Parse unified heroes.csv → names, heroStats, tierList. */
function parseHeroesTable(text) {
  const heroes = {};
  const heroStats = {};
  const tierList = {};
  if (!text) return { heroes, heroStats, tierList };

  const rows = parseCsv(text);
  const header = rows[0] || [];
  const start = header[0] === "slug" ? 1 : 0;
  const col = (name) => header.indexOf(name);

  const iName = col("name");
  const iWin = col("win_pct");
  const iPlays = col("plays");
  const iRating = col("rating_pct");
  const iTier = col("tier");
  const iBt = col("bt_pct");
  const iBtGames = col("bt_games");

  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    const slug = row[0];
    if (!slug) continue;

    if (iName >= 0 && row[iName]) heroes[slug] = row[iName];

    const winPct = iWin >= 0 ? num(row[iWin]) : null;
    const plays = iPlays >= 0 ? num(row[iPlays]) : null;
    const rating = iRating >= 0 ? num(row[iRating]) : null;
    if (winPct != null && plays != null && plays > 0) {
      heroStats[slug] = {
        winRate: winPct / 100,
        totalPlays: Math.floor(plays),
        rating: rating != null ? rating / 100 : null,
      };
    }

    const tier = iTier >= 0 ? row[iTier] : "";
    const btPct = iBt >= 0 ? num(row[iBt]) : null;
    const btGames = iBtGames >= 0 ? num(row[iBtGames]) : null;
    if (tier && btPct != null && btGames != null && btGames >= 10) {
      tierList[slug] = {
        tier,
        bt: btPct / 100,
        games: Math.floor(btGames),
      };
    }
  }

  return { heroes, heroStats, tierList };
}

export async function loadMatchupData() {
  const [heroesText, matchupsText, playsText] = await Promise.all([
    fetch("data/heroes.csv").then((r) => {
      if (!r.ok) throw new Error("heroes.csv not found");
      return r.text();
    }),
    fetch("data/matchups.csv").then((r) => {
      if (!r.ok) throw new Error("matchups.csv not found");
      return r.text();
    }),
    fetch("data/plays.csv").then((r) => (r.ok ? r.text() : "")),
  ]);

  const { heroes, heroStats, tierList } = parseHeroesTable(heroesText);

  const mRows = parseCsv(matchupsText);
  const matchups = parseMatrix(mRows, (cell) => {
    const pct = Number(cell);
    return Number.isNaN(pct) ? null : pct / 100;
  });

  const plays = playsText
    ? parseMatrix(parseCsv(playsText), (cell) => {
        const n = Number(cell);
        return Number.isNaN(n) || n <= 0 ? null : Math.floor(n);
      })
    : {};

  return { heroes, matchups, plays, heroStats, tierList };
}
