import { fetchResilient, HttpError } from "../util/net";
import { buildMagnet } from "./magnet";
import { unescapeEntities } from "./rss";
import { parseSize } from "../util/format";
import type { SearchOptions, Source, TorrentResult } from "./types";

const HOSTS = ["audiobookbay.lu", "audiobookbay.is", "theaudiobookbay.se"];
let workingHostIndex = 0;
const MAX_DETAILS = 4;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "by", "in", "on", "at", "for"]);
const METADATA_WORDS = new Set([
  "english", "spanish", "french", "german", "audiobook", "audiobooks",
  "unabridged", "abridged", "mp3", "m4b", "flac", "edition", "book", "vol", "volume"
]);

interface Row {
  name: string;
  path: string;
}

export function parsePostRows(html: string): Row[] {
  const out: Row[] = [];
  const matches = html.matchAll(/<div[^>]*class="[^"]*postTitle[^"]*"[^>]*>\s*<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi);
  for (const m of matches) {
    if (m[1] && m[2]) {
      out.push({
        path: m[1].trim(),
        name: unescapeEntities(m[2].trim()),
      });
    }
  }
  return out;
}

export function parseDetailInfo(html: string): { infoHash?: string; sizeBytes?: number } {
  const hashMatch = html.match(/Info Hash:[\s\S]*?<td>\s*([a-fA-F0-9]{40})/i);
  
  const sizeRowMatch =
    html.match(/Combined File Size:[\s\S]*?<td>([\s\S]*?)<\/td>/i) ||
    html.match(/File Size:[\s\S]*?<td>([\s\S]*?)<\/td>/i) ||
    html.match(/File Size:[\s\S]*?([0-9.]+\s*(?:GB|MB|KB)s?)/i);

  let sizeBytes = 0;
  if (sizeRowMatch?.[1]) {
    const cleanSizeText = sizeRowMatch[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .replace(/GBs?/i, "GB")
      .replace(/MBs?/i, "MB")
      .replace(/KBs?/i, "KB")
      .trim();
    sizeBytes = parseSize(cleanSizeText);
  }

  return {
    infoHash: hashMatch?.[1]?.toLowerCase(),
    sizeBytes,
  };
}

async function fetchText(url: string, opts: SearchOptions, retries: number): Promise<string> {
  const res = await fetchResilient(url, {
    headers: { "User-Agent": BROWSER_UA },
    signal: opts.signal,
    retries,
  });
  if (!res.ok) throw new HttpError(res.status, `AudioBookBay returned ${res.status}`);
  return res.text();
}

async function search(query: string, opts: SearchOptions = {}): Promise<TorrentResult[]> {
  const q = query.trim();
  const path = q ? `/?s=${encodeURIComponent(q.toLowerCase()).replace(/%20/g, "+")}` : "/";

  let base = "";
  let html = "";
  let lastError: unknown;

  for (let i = 0; i < HOSTS.length; i++) {
    const hostIdx = (workingHostIndex + i) % HOSTS.length;
    const host = HOSTS[hostIdx];
    try {
      const candidate = `https://${host}`;
      html = await fetchText(`${candidate}${path}`, opts, i === 0 ? 2 : 0);
      base = candidate;
      workingHostIndex = hostIdx;
      break;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastError = e;
    }
  }

  if (!base) throw lastError instanceof Error ? lastError : new HttpError(0, "AudioBookBay unreachable");

  const all = parsePostRows(html);
  const qLower = q.toLowerCase();
  const tokens = qLower.split(/\s+/).filter(Boolean);
  const mainTerms = tokens.filter((t) => !STOP.has(t) && !METADATA_WORDS.has(t));

  const scored = all.map((r) => {
    const n = r.name.toLowerCase();
    let score = 0;
    if (n.includes(qLower)) score += 100;
    for (const token of tokens) {
      if (STOP.has(token)) continue;
      if (n.includes(token)) {
        score += METADATA_WORDS.has(token) ? 5 : 20;
      }
    }
    return { row: r, score };
  });

  let filtered = scored;
  if (mainTerms.length > 0) {
    const mainMatches = scored.filter(({ row }) => {
      const n = row.name.toLowerCase();
      return mainTerms.some((term) => n.includes(term));
    });
    if (mainMatches.length > 0) {
      filtered = mainMatches;
    }
  }

  filtered.sort((a, b) => b.score - a.score);
  const rows = filtered.map((item) => item.row).slice(0, MAX_DETAILS);

  const results: TorrentResult[] = [];
  for (const row of rows) {
    if (opts.signal?.aborted) break;
    try {
      const detailHtml = await fetchText(`${base}${row.path}`, opts, 1);
      const { infoHash, sizeBytes } = parseDetailInfo(detailHtml);
      if (infoHash) {
        results.push({
          infoHash,
          name: row.name,
          sizeBytes: sizeBytes ?? 0,
          seeders: 1,
          leechers: 0,
          source: "audiobookbay",
          magnet: buildMagnet(infoHash, row.name),
        });
      }
    } catch {
      // Continue to next row if one detail page fails
    }
  }

  return results;
}

export const audiobookbay: Source = {
  id: "audiobookbay",
  label: "AudioBook Bay",
  groups: ["Audiobooks"],
  homepage: "https://audiobookbay.is",
  reportsHealth: true,
  search: (query, opts) => search(query, opts),
};
