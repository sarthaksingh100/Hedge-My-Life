const DEFAULT_BASE_URL = "https://api.anakin.io/v1";
const ODDSPIPE_BASE_URL = "https://oddspipe.com/v1";

export async function findLiveMarkets({ query, queries, category, signal }) {
  const apiKey = process.env.ANAKIN_API_KEY;
  const oddspipeApiKey = process.env.ODDSPIPE_API_KEY;
  const useLive = process.env.ANAKIN_USE_LIVE === "true";

  if ((!apiKey || !useLive) && !oddspipeApiKey) {
    return { source: "none", markets: [], reason: "Live provider keys are missing or disabled." };
  }

  const baseUrl = process.env.ANAKIN_BASE_URL || DEFAULT_BASE_URL;
  const searchQueries = normalizeQueries(queries?.length ? queries : [query]);
  const markets = [];
  const errors = [];

  for (const [queryIndex, searchQuery] of searchQueries.entries()) {
    const focusedQuery = buildSearchQuery(searchQuery, category);

    if (apiKey && useLive) {
      try {
        const searchData = await executeWireTask({
          apiKey,
          baseUrl,
          actionId: "pm_search_markets",
          params: { query: focusedQuery, limit: 10, closed: false },
          signal
        });
        const candidates = polymarketCandidateMarkets(searchData, focusedQuery, category).slice(0, 6);
        markets.push(...normalizePolymarketSearchCandidates(candidates, focusedQuery, category));

        const details = await fetchPolymarketDetails({ apiKey, baseUrl, candidates: candidates.slice(0, 3), signal });
        for (const detail of details) {
          markets.push(...normalizePolymarketDetail(detail, focusedQuery, category));
        }
      } catch (error) {
        errors.push(`pm_search_markets: ${error.message}`);
      }

      try {
        const searchData = await executeWireTask({
          apiKey,
          baseUrl,
          actionId: "rh_get_markets",
          params: { search: focusedQuery, limit: 20, live_only: true },
          signal
        });
        const events = robinhoodCandidateEvents(searchData, focusedQuery, category).slice(0, 3);
        const details = await fetchRobinhoodEventDetails({ apiKey, baseUrl, events, signal });
        for (const detail of details) {
          markets.push(...normalizeRobinhoodEventDetail(detail, focusedQuery, category));
        }
      } catch (error) {
        errors.push(`rh_get_markets: ${error.message}`);
      }

      if (queryIndex === 0) {
        try {
          const kalshiData = await executeWireTask({
            apiKey,
            baseUrl,
            actionId: "kl_events",
            params: {
              limit: 200,
              status: "open",
              with_nested_markets: true,
              min_close_ts: Math.floor(Date.now() / 1000)
            },
            signal
          });
          markets.push(...normalizeKalshiEvents(kalshiData, focusedQuery, category));
        } catch (error) {
          errors.push(`kl_events: ${error.message}`);
        }
      }
    }

    if (oddspipeApiKey) {
      try {
        const oddspipeData = await fetchOddspipeMarkets({
          apiKey: oddspipeApiKey,
          query: focusedQuery,
          signal
        });
        markets.push(...normalizeOddspipeMarkets(oddspipeData, focusedQuery, category));
      } catch (error) {
        errors.push(`oddspipe_search: ${error.message}`);
      }
    }
  }

  const uniqueMarkets = dedupeMarkets(markets).slice(0, 12);

  return {
    source: uniqueMarkets.length ? "anakin" : "none",
    markets: uniqueMarkets,
    reason: uniqueMarkets.length
      ? "Live markets returned from Kalshi, Polymarket, Robinhood, or Oddspipe."
      : `No real Kalshi, Polymarket, Robinhood, or Oddspipe market matched these searches: ${searchQueries.join(", ")}.${
          errors.length ? ` Errors: ${errors.slice(0, 2).join(" | ")}` : ""
        }`
  };
}

async function fetchOddspipeMarkets({ apiKey, query, signal }) {
  const url = new URL(`${ODDSPIPE_BASE_URL}/markets/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");

  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `Oddspipe search failed (${response.status})`);
  }
  return payload;
}

async function fetchPolymarketDetails({ apiKey, baseUrl, candidates, signal }) {
  const details = [];

  for (const candidate of candidates) {
    const marketId = String(candidate.id || "").trim();
    if (!marketId) continue;

    const detail = await tryWireTasks([
      { actionId: "pm_get_market_full", params: { market_id: marketId } },
      { actionId: "pm_get_market", params: { market_id: marketId } }
    ], { apiKey, baseUrl, signal });

    if (detail) {
      detail.event_slug = candidate.event?.slug;
      details.push(detail);
    }
  }

  return details;
}

async function fetchRobinhoodEventDetails({ apiKey, baseUrl, events, signal }) {
  const details = [];

  for (const event of events) {
    const params = event.slug ? { slug: event.slug } : { event_id: event.id };
    const detail = await tryWireTasks([{ actionId: "rh_get_event", params }], { apiKey, baseUrl, signal });
    if (detail) details.push(detail);
  }

  return details;
}

async function tryWireTasks(tasks, context) {
  for (const task of tasks) {
    try {
      return await executeWireTask({ ...context, actionId: task.actionId, params: task.params });
    } catch {
      // Try the next detail endpoint for this candidate.
    }
  }
  return null;
}

async function executeWireTask({ apiKey, baseUrl, actionId, params, signal }) {
  const submit = await fetch(`${baseUrl}/holocron/task`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action_id: actionId, params }),
    signal
  });

  const submitted = await submit.json().catch(() => ({}));
  if (!submit.ok) {
    throw new Error(submitted.error?.message || submitted.message || `Task submission failed (${submit.status})`);
  }

  if (submitted.data) return submitted.data;

  const jobId = submitted.job_id || submitted.id;
  if (!jobId) return submitted;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    await delay(1000, signal);
    const job = await fetch(`${baseUrl}/holocron/jobs/${jobId}`, {
      headers: { "X-API-Key": apiKey },
      signal
    });
    const payload = await job.json().catch(() => ({}));
    if (!job.ok) throw new Error(payload.error?.message || `Job polling failed (${job.status})`);
    if (payload.status === "completed") return payload.data || payload.generatedJson || payload;
    if (payload.status === "failed") throw new Error(payload.error?.message || payload.error?.code || "Wire job failed");
  }

  throw new Error(`${actionId} timed out while polling`);
}

function polymarketCandidateMarkets(data, query, category) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const candidates = [];

  for (const event of events) {
    const tags = Array.isArray(event.tags) ? event.tags.map((tag) => tag.label || tag.slug).filter(Boolean) : [];
    const markets = Array.isArray(event.markets) ? event.markets : [];

    for (const market of markets) {
      const title = market.question || market.title || event.title;
      const description = `${event.title || ""} ${event.description || ""} ${tags.join(" ")}`;
      const price = yesPriceFromPolymarket(market);
      if (!isUsableMarket({ title, description, price, row: market, query, category })) continue;
      candidates.push({ ...market, event, event_tags: tags });
    }
  }

  return candidates.sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0));
}

function normalizePolymarketSearchCandidates(candidates, query, category) {
  return candidates.map((market) => {
    const title = market.question || market.title || market.event?.title;
    const description = market.event?.description || market.description || "";
    const price = yesPriceFromPolymarket(market);
    const eventSlug = market.event?.slug;

    return {
      id: `pm-search-${market.id || slugify(title)}`,
      platform: "Polymarket",
      sourceType: "search",
      title,
      description: cleanDescription(description) || "Active Polymarket market from Search Markets.",
      eventDate: formatDate(market.end_date || market.event?.end_date),
      yesPrice: price,
      probability: price,
      volume: formatVolume(market.volume || market.event?.volume),
      category: market.event_tags?.[0] || category || "Market",
      url: polymarketUrl(market, eventSlug, title)
    };
  });
}

function normalizePolymarketDetail(detail, query, category) {
  if (!detail || typeof detail !== "object") return [];

  const title = detail.question || detail.title || detail.slug;
  const description = detail.description || "";
  const price = yesPriceFromPolymarket(detail);
  if (!isUsableMarket({ title, description, price, row: detail, query, category })) return [];

  const tags = Array.isArray(detail.tags) ? detail.tags.map((tag) => tag.label || tag.slug).filter(Boolean) : [];
  const eventSlug = detail.event_slug || detail.event?.slug;

  return [
    {
      id: `pm-detail-${detail.id || slugify(title)}`,
      platform: "Polymarket",
      sourceType: "detail",
      title,
      description: cleanDescription(description) || "Live Polymarket market detail returned by Anakin Wire.",
      eventDate: formatDate(detail.end_date || detail.endDate),
      yesPrice: price,
      probability: price,
      volume: formatVolume(detail.volume || detail.volume_num),
      category: tags[0] || category || "Market",
      url: polymarketUrl(detail, eventSlug, title)
    }
  ];
}

function robinhoodCandidateEvents(data, query, category) {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .filter((event) => {
      const title = event.name || event.title || "";
      const description = `${event.description || ""} ${event.long_description || ""} ${event.category || ""}`;
      return relevanceScore(`${title} ${description}`, query, category) >= 1;
    })
    .sort((a, b) => Number(b.total_open_interest || 0) - Number(a.total_open_interest || 0));
}

function normalizeRobinhoodEventDetail(event, query, category) {
  if (!event || typeof event !== "object") return [];
  const contracts = Array.isArray(event.contracts) ? event.contracts : [];
  const normalized = [];

  for (const contract of contracts) {
    const title = robinhoodContractTitle(event, contract);
    const description =
      event.long_description ||
      event.description ||
      contract.name ||
      "Live Robinhood event detail returned by Anakin Wire.";
    const price = parsePrice(contract.yes_ask ?? contract.ask_price ?? contract.yes_bid ?? contract.last_trade_price);
    const text = `${event.name || ""} ${description} ${event.category || ""} ${title}`;

    if (!isUsableMarket({ title, description: text, price, row: contract, query, category })) continue;
    if (contract.tradability && !/tradable/i.test(contract.tradability)) continue;
    if (contract.quote_state && !/active/i.test(contract.quote_state)) continue;

    normalized.push({
      id: `rh-detail-${contract.id || contract.symbol || slugify(title)}`,
      platform: "Robinhood",
      sourceType: "detail",
      title,
      description: cleanDescription(cleanRobinhoodText(description)),
      eventDate: formatDate(robinhoodContractDate(contract, event)),
      yesPrice: price,
      probability: price,
      volume: formatVolume(contract.volume || event.total_volume),
      category: event.category || category || "Market",
      url: robinhoodUrl(event, contract, title)
    });
  }

  return normalized;
}

function robinhoodContractTitle(event, contract) {
  const eventName = cleanRobinhoodText(event.name || event.title || "");
  const outcome = cleanRobinhoodText(contract.display_long_name || contract.name || "");
  if (eventName && outcome) return `${eventName}: ${outcome}`;
  return cleanRobinhoodText(contract.description || eventName || outcome);
}

function robinhoodContractDate(contract, event) {
  const fromDescription = String(contract.description || "").match(/\b(?:on|by|before)\s+([A-Z][a-z]+ \d{1,2}, \d{4})\b/);
  if (fromDescription) return fromDescription[1];
  return contract.expiration_date || event.timeline?.find((item) => /event/i.test(item.title))?.timestamp;
}

function cleanRobinhoodText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\babove\s+above\b/gi, "above")
    .replace(/\bbelow\s+below\b/gi, "below")
    .trim();
}

function normalizeKalshiEvents(data, query, category) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const normalized = [];

  for (const event of events) {
    const markets = Array.isArray(event.markets) ? event.markets : [];
    for (const market of markets) {
      const title = market.title || event.title || market.ticker;
      const description =
        market.rules_primary ||
        market.rules_secondary ||
        event.sub_title ||
        event.title ||
        "Live Kalshi market returned by Anakin Wire.";
      const price = parsePrice(
        market.yes_ask_dollars ??
          market.yes_bid_dollars ??
          market.last_price_dollars ??
          market.previous_price_dollars
      );
      const text = `${title} ${description} ${event.title || ""} ${event.category || ""}`;

      if (market.status && !/active|open/i.test(market.status)) continue;
      if (!isUsableMarket({ title, description: text, price, row: market, query, category })) continue;

      normalized.push({
        id: `kl-${market.ticker || event.event_ticker || slugify(title)}`,
        platform: "Kalshi",
        sourceType: "detail",
        title,
        description: cleanDescription(description),
        eventDate: formatDate(market.close_time || market.expiration_time || market.expected_expiration_time),
        yesPrice: price,
        probability: price,
        volume: formatVolume(market.volume_fp || market.open_interest_fp || market.liquidity_dollars),
        category: event.category || category || "Market",
        url: kalshiUrl(market, title)
      });
    }
  }

  return normalized;
}

function normalizeOddspipeMarkets(data, query, category) {
  const items = Array.isArray(data?.items) ? data.items : [];

  return items
    .map((item) => {
      const price = parsePrice(item.source?.latest_price?.yes_price);
      const title = item.title;
      const description = `Oddspipe ${titleCase(item.source?.platform || "market")} search result.`;

      if (String(item.status || "").toLowerCase() !== "active") return null;
      if (!item.source?.url) return null;
      if (!isUsableMarket({ title, description, price, row: item, query, category })) return null;

      return {
        id: `op-${item.id || slugify(title)}`,
        platform: "Oddspipe",
        sourceType: "search",
        title,
        description,
        eventDate: formatDate(item.source?.latest_price?.snapshot_at || item.created_at),
        yesPrice: price,
        probability: price,
        volume: formatVolume(item.source?.latest_price?.volume_usd),
        category: item.category || category || "Market",
        url: item.source.url
      };
    })
    .filter(Boolean);
}

function isUsableMarket({ title, description, price, row, query, category }) {
  if (!title || String(title).length > 180) return false;
  if (!Number.isFinite(price) || price < 0.03 || price > 0.97) return false;
  if (row?.closed === true || row?.active === false) return false;
  const tokenCount = importantTokens(query).length;
  const titleMatches = directTokenMatches(title, query);
  return titleMatches > 0 && (relevanceScore(`${title} ${description}`, query, category) >= 2 || tokenCount <= 2);
}

function yesPriceFromPolymarket(market) {
  const tokens = Array.isArray(market.tokens) ? market.tokens : [];
  const yesToken = tokens.find((token) => String(token.outcome).toLowerCase() === "yes");
  if (yesToken) return parsePrice(yesToken.current_price ?? yesToken.mid_price ?? yesToken.buy_price ?? yesToken.last_trade_price);

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const prices = Array.isArray(market.outcome_prices) ? market.outcome_prices : [];
  const yesIndex = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === "yes");
  const value = prices[yesIndex >= 0 ? yesIndex : 0] ?? market.best_ask ?? market.last_trade_price;
  return parsePrice(value);
}

function buildSearchQuery(query, category) {
  const text = String(query || "").toLowerCase();
  if (text.split(/\s+/).filter(Boolean).length <= 5) return query;
  if (/gas|fuel|commute|uber|drive/.test(text)) return "gas prices";
  if (/rain|snow|storm|weather|vacation|trip/.test(text)) return "weather";
  if (/flight|airport|airline|delay|travel/.test(text)) return "flight delays";
  if (/grocery|food|inflation/.test(text)) return "inflation";
  return category && category !== "Weather" ? `${category} ${query}` : query;
}

function relevanceScore(text, query, category) {
  const words = normalizedWords(text);
  const tokens = importantTokens(query);
  let score = tokens.reduce((total, token) => total + (words.has(token) ? 1 : 0), 0);

  const categoryTerms = {
    Weather: ["weather", "rain", "precipitation", "temperature", "storm", "snow", "hurricane"],
    Commute: ["gas", "fuel", "oil", "transit", "transportation", "commute"],
    Travel: ["flight", "airline", "airport", "travel", "delay", "weather"],
    Bills: ["energy", "electricity", "gas", "utility", "inflation"],
    Groceries: ["food", "grocery", "cpi", "inflation"]
  };

  for (const term of categoryTerms[category] || []) {
    if (words.has(term)) score += 1;
  }

  return score;
}

function directTokenMatches(text, query) {
  const words = normalizedWords(text);
  return importantTokens(query).filter((token) => words.has(token)).length;
}

function importantTokens(query) {
  const stop = new Set([
    "the",
    "and",
    "that",
    "this",
    "from",
    "with",
    "will",
    "would",
    "worried",
    "about",
    "heavy",
    "ruins",
    "ruined",
    "beach",
    "vacation",
    "between",
    "during",
    "above",
    "below",
    "least",
    "there"
  ]);
  return normalizeText(query)
    .split(" ")
    .filter((token) => token.length > 3 && !stop.has(token))
    .slice(0, 8);
}

function normalizeQueries(queries) {
  const seen = new Set();
  return queries
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function dedupeMarkets(markets) {
  const seen = new Set();
  return markets.filter((market) => {
    const key = `${market.platform}:${market.sourceType || "live"}:${slugify(market.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedWords(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function cleanDescription(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function formatDate(value) {
  if (!value) return "Live market";
  if (Number.isFinite(Number(value))) {
    return new Date(Number(value) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1000000) return `$${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `$${(number / 1000).toFixed(1)}K`;
  return `$${Math.round(number)}`;
}

function polymarketUrl(detail, eventSlug, title) {
  if (eventSlug) return `https://polymarket.com/event/${eventSlug}`;
  if (detail.event?.slug) return `https://polymarket.com/event/${detail.event.slug}`;
  if (detail.slug) return `https://polymarket.com/search?search=${encodeURIComponent(detail.slug)}`;
  return `https://polymarket.com/search?search=${encodeURIComponent(title)}`;
}

function robinhoodUrl(event, contract, title) {
  if (event.slug) {
    const category = slugify(event.category || "markets");
    return `https://robinhood.com/us/en/prediction-markets/${category}/events/${event.slug}/`;
  }
  if (contract.symbol) return `https://robinhood.com/forecast?query=${encodeURIComponent(contract.symbol)}`;
  return `https://robinhood.com/forecast?query=${encodeURIComponent(title)}`;
}

function kalshiUrl(row, title) {
  const ticker = pick(row, ["ticker", "market_ticker"]);
  return ticker ? `https://kalshi.com/search?query=${encodeURIComponent(ticker)}` : `https://kalshi.com/search?query=${encodeURIComponent(title)}`;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return "";
}

function parsePrice(value) {
  if (typeof value === "string") {
    const cleaned = value.replace("%", "").replace("$", "").trim();
    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) return NaN;
    return numeric > 1 ? numeric / 100 : numeric;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return numeric > 1 ? numeric / 100 : numeric;
}

function titleCase(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Request aborted"));
    });
  });
}
