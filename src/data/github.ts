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
