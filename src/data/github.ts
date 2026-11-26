import { readFile, writeFile } from "node:fs/promises";

export interface Day {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}
export interface Contributions {
  total: number;
  days: Day[];
}

const USER = "JackGraver";
const CACHE = new URL("./contributions.json", import.meta.url);
let memo: Promise<Contributions | null> | undefined;

async function load(): Promise<Contributions | null> {
  try {
    const res = await fetch(
      `https://github-contributions-api.jogruber.de/v4/${USER}?y=last`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data: Contributions = {
      total: json.total?.lastYear ?? 0,
      days: json.contributions,
    };
    await writeFile(CACHE, JSON.stringify(data));
    return data;
  } catch (err) {
    console.warn(`[github] live fetch failed (${err}); using cached data`);
    try {
      return JSON.parse(await readFile(CACHE, "utf8"));
    } catch {
      return null;
    }
  }
}

// One fetch per build / dev-server process.
export const getContributions = () => (memo ??= load());

/** Group days into Sunday-start week columns, padding the first week. */
export function toWeeks(days: Day[]): (Day | null)[][] {
  const weeks: (Day | null)[][] = [];
  let week: (Day | null)[] = Array(new Date(days[0].date + "T00:00:00Z").getUTCDay()).fill(null);
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week);
  return weeks;
}

// ---------------------------------------------------------------------------------------------
// Activity detail: which projects were worked on each day, plus a language breakdown.
//
// Day -> repos comes from the GraphQL API (commit contributions grouped by repo, with the day of each),
// in 30-day windows so no repo overflows the 100-node page. PUBLIC REPOS ONLY: private repos are
// filtered out explicitly, so their names can never reach the page. GraphQL needs a token (the
// Action's GITHUB_TOKEN, or GITHUB_TOKEN / GH_TOKEN locally); without one everything falls back to
// the cached copy, and every piece fails soft.
// ---------------------------------------------------------------------------------------------
/** repos: public repos using the language, as [name, share of that repo's code in %], biggest share first */
export interface Lang { name: string; pct: number; repos: [string, number][] }
export interface Activity {
  /** "YYYY-MM-DD" -> [repo, commits][], busiest first */
  byDay: Record<string, [string, number][]>;
  langs: Lang[];
}

const ACTIVITY_CACHE = new URL("./activity.json", import.meta.url);
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const rest = async (path: string) => {
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
};
const graphql = async (query: string, variables: Record<string, unknown>) => {
  if (!token) throw new Error("no token");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`graphql ${res.status} ${JSON.stringify(json.errors ?? "")}`.slice(0, 200));
  return json.data;
};

const WINDOW_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { name isPrivate }
        contributions(first: 100) { nodes { occurredAt commitCount } }
      }
    }
  }
}`;

async function loadByDay(): Promise<Activity["byDay"]> {
  const DAY = 86_400_000, STEP = 30 * DAY;
  const end = Date.now();
  const windows: [string, string][] = [];
  for (let from = end - 372 * DAY; from < end; from += STEP) {
    windows.push([new Date(from).toISOString(), new Date(Math.min(from + STEP, end)).toISOString()]);
  }
  const perDay = new Map<string, Map<string, number>>();
  const results = await Promise.all(windows.map(([from, to]) => graphql(WINDOW_QUERY, { login: USER, from, to })));
  for (const data of results) {
    for (const r of data.user.contributionsCollection.commitContributionsByRepository) {
      if (r.repository.isPrivate) continue; // never publish private repo names
      for (const n of r.contributions.nodes) {
        const day = n.occurredAt.slice(0, 10);
        const m = perDay.get(day) ?? perDay.set(day, new Map()).get(day)!;
        m.set(r.repository.name, (m.get(r.repository.name) ?? 0) + n.commitCount);
      }
    }
  }
  const byDay: Activity["byDay"] = {};
  for (const [day, repos] of perDay) byDay[day] = [...repos].sort((a, b) => b[1] - a[1]);
  return byDay;
}

async function loadLangs(): Promise<Lang[]> {
  const repos: any[] = await rest(`/users/${USER}/repos?type=owner&sort=pushed&per_page=100`);
  const bytes = new Map<string, number>();
  const users = new Map<string, [string, number][]>(); // language -> repos using it (>= 5% of the repo)
  for (const r of repos.filter((r) => !r.fork && !r.private).slice(0, 20)) {
    try {
      const l = await rest(`/repos/${r.full_name}/languages`);
      const repoTotal = Object.values<number>(l).reduce((a, b) => a + b, 0);
      for (const [k, v] of Object.entries<number>(l)) {
        bytes.set(k, (bytes.get(k) ?? 0) + v);
        const share = (v / repoTotal) * 100;
        if (share >= 5) users.set(k, [...(users.get(k) ?? []), [r.name, share]]);
      }
    } catch {}
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  if (!total) throw new Error("no language data");
  const sorted = [...bytes].sort((a, b) => b[1] - a[1]);
  const top: Lang[] = sorted.slice(0, 6).map(([name, v]) => ({
    name,
    pct: (v / total) * 100,
    repos: (users.get(name) ?? []).sort((a, b) => b[1] - a[1]),
  }));
  const other = sorted.slice(6).reduce((a, [, v]) => a + v, 0);
  if (other) top.push({ name: "Other", pct: (other / total) * 100, repos: [] });
  return top;
}

let actMemo: Promise<Activity | null> | undefined;
async function loadActivity(): Promise<Activity | null> {
  let cached: Partial<Activity> = {};
  try { cached = JSON.parse(await readFile(ACTIVITY_CACHE, "utf8")); } catch {}
  const soft = async <T,>(label: string, fn: () => Promise<T>, fallback: T) => {
    try { return await fn(); } catch (err) { console.warn(`[github] ${label} failed (${err}); using cached`); return fallback; }
  };
  const byDay = await soft("repos by day", loadByDay, cached.byDay ?? {});
  const langs = await soft("languages", loadLangs, cached.langs ?? []);
  const out: Activity = { byDay, langs };
  if (!Object.keys(out.byDay).length && !out.langs.length) return null;
  await writeFile(ACTIVITY_CACHE, JSON.stringify(out)).catch(() => {});
  return out;
}
export const getActivity = () => (actMemo ??= loadActivity());
