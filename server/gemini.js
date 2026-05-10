const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-flash-latest";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";

export async function planConcernWithGemini({ concern, category, signal }) {
  const openRouterPlan = await planWithOpenRouter({ concern, category, signal });
  if (openRouterPlan) return openRouterPlan;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let response;
  try {
    response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "X-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt(concern, category)
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.35,
          responseMimeType: "application/json"
        }
      }),
      signal
    });
  } catch (error) {
    console.warn(`[GEMINI] Query planning skipped: ${error.message}`);
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn(`[GEMINI] Query planning skipped: ${payload.error?.message || `request failed (${response.status})`}`);
    return null;
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(`[GEMINI] Query planning skipped: invalid JSON (${error.message})`);
    return null;
  }

  return {
    summary: stringOrDefault(parsed.summary, "Mapped your concern to hedgeable proxy risks."),
    category: stringOrDefault(parsed.category, category),
    searchQueries: arrayOfStrings(parsed.searchQueries).slice(0, 4),
    providerQueries: normalizeProviderQueries(parsed.providerQueries),
    suggestedBets: normalizeSuggestedBets(parsed.suggestedBets, category).slice(0, 4)
  };
}

async function planWithOpenRouter({ concern, category, signal }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  let response;

  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:5173",
        "X-Title": "Hedge My Life"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are a precise prediction-market query planner. Return strict JSON only."
          },
          {
            role: "user",
            content: buildPrompt(concern, category)
          }
        ],
        temperature: 0.2,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      }),
      signal
    });
  } catch (error) {
    console.warn(`[OPENROUTER] Query planning skipped: ${error.message}`);
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn(`[OPENROUTER] Query planning skipped: ${payload.error?.message || `request failed (${response.status})`}`);
    return null;
  }

  const text = payload.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(text, "OPENROUTER");
  if (!parsed) return null;

  return normalizePlan(parsed, category);
}

function buildPrompt(concern, category) {
  const today = new Date().toISOString().slice(0, 10);

  return `You are helping build a hackathon app called Hedge My Life.

The user gives a real-life worry. Prediction markets may not have an exact contract, so map the worry to hedgeable proxy risks.

Today's date is ${today}. If the user gives a month/day but no year, use the next upcoming occurrence.
User concern: ${JSON.stringify(concern)}
Selected category: ${JSON.stringify(category)}

Return strict JSON only with this shape:
{
  "summary": "one short sentence explaining the mapped risk",
  "category": "Travel | Commute | Weather | Health | Economy | Politics | Crypto | Sports | Groceries | Bills | Other",
  "searchQueries": ["short prediction market search query", "..."],
  "providerQueries": {
    "polymarket": ["keyword query", "..."],
    "robinhood": ["keyword query", "..."],
    "kalshi": ["keyword query", "..."],
    "oddspipe": ["keyword query", "..."]
  },
  "suggestedBets": [
    {
      "title": "market question someone could create",
      "description": "why this would hedge the user's concern",
      "platformFit": "Kalshi | Polymarket | Robinhood",
      "settlementSource": "objective data source for settlement",
      "eventWindow": "human-readable date/window"
    }
  ]
}

Rules:
- Prefer weather, flight delay, local commute, lodging, air quality, inflation, or energy-cost proxies.
- Search queries should be broad enough for Polymarket/Kalshi search, like "SFO flight delays", "Bay Area weather", "gas prices", "inflation", "air quality".
- Provider queries should be short marketplace keywords, not full sentences. Oddspipe works best with entity/event terms such as "measles cases", "gas prices", "recession", "fed chair", "SFO delays".
- Return the category that best describes the user concern. Do not force crypto, politics, health, or macroeconomic concerns into Bills or Weather.
- Avoid ambiguous single words that create false matches. For weather concerns, include location and outcome terms like "Bay Area rain", "San Jose temperature", or "SFO delays" rather than just "weather".
- If the user asks an open-ended question like "how will my trip/event/commute be between these dates", infer likely hedgeable risk buckets from the location, dates, and activity instead of treating it as one literal search.
- For travel, consider airport or airline delays, local weather, temperature, air quality, transit or rideshare disruption, major local events, lodging demand, and fuel costs when relevant.
- For commutes, consider gas prices, traffic disruption, transit strikes, weather, tolls, and local events.
- For bills or groceries, consider inflation, energy prices, CPI categories, commodity prices, and regional weather disruptions.
- For any location-specific concern, include location-aware query terms. For example, an SFO trip can map to "SFO delays" and "Bay Area rain"; a Miami trip can map to "Miami rain", "hurricane", or "MIA delays"; a New York commute can map to "NYC transit", "MTA strike", or "gas prices".
- For this session, the next upcoming June 23-25 is June 23-25, 2026. Use 2026 for that date range unless the user explicitly gives another year.
Suggested bets are not live markets. Do not include prices, odds, links, or probabilities for suggestedBets.
Keep suggested bet titles objective and settleable, preferably phrased as yes/no questions.`;
}

function normalizePlan(parsed, category) {
  return {
    summary: stringOrDefault(parsed.summary, "Mapped your concern to hedgeable proxy risks."),
    category: stringOrDefault(parsed.category, category),
    searchQueries: arrayOfStrings(parsed.searchQueries).slice(0, 4),
    providerQueries: normalizeProviderQueries(parsed.providerQueries),
    suggestedBets: normalizeSuggestedBets(parsed.suggestedBets, category).slice(0, 4)
  };
}

function parseJsonObject(text, providerName) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn(`[${providerName}] Query planning skipped: response was not JSON`);
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (error) {
      console.warn(`[${providerName}] Query planning skipped: invalid JSON (${error.message})`);
      return null;
    }
  }
}

function normalizeProviderQueries(value) {
  const providers = ["polymarket", "robinhood", "kalshi", "oddspipe"];
  return Object.fromEntries(
    providers.map((provider) => [provider, arrayOfStrings(value?.[provider]).slice(0, 3)])
  );
}

function normalizeSuggestedBets(bets, fallbackCategory) {
  if (!Array.isArray(bets)) return [];

  return bets
    .map((bet, index) => {
      const title = stringOrDefault(bet.title, "").slice(0, 140);
      const description = stringOrDefault(bet.description, "A possible market idea for this concern.");
      if (!title) return null;

      return {
        id: `gemini-idea-${index}-${slugify(title)}`,
        title,
        description,
        platformFit: platformOrDefault(bet.platformFit),
        settlementSource: stringOrDefault(bet.settlementSource, "Public objective data source"),
        eventWindow: stringOrDefault(bet.eventWindow, "Relevant event window"),
        category: stringOrDefault(bet.category, fallbackCategory),
        sourceType: "gemini-suggestion"
      };
    })
    .filter(Boolean);
}

function platformOrDefault(value) {
  const text = String(value || "").trim();
  if (/kalshi/i.test(text)) return "Kalshi";
  if (/robinhood/i.test(text)) return "Robinhood";
  return "Polymarket";
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function stringOrDefault(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 36);
}
