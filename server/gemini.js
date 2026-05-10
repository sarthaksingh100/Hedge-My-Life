const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

export async function planConcernWithGemini({ concern, category, signal }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  let response;
  try {
    response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
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
    suggestedBets: normalizeSuggestedBets(parsed.suggestedBets, category).slice(0, 4)
  };
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
  "category": "Weather | Travel | Commute | Bills | Groceries",
  "searchQueries": ["short prediction market search query", "..."],
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
- For this session, the next upcoming June 23-25 is June 23-25, 2026. Use 2026 for that date range unless the user explicitly gives another year.
Suggested bets are not live markets. Do not include prices, odds, links, or probabilities for suggestedBets.
Keep suggested bet titles objective and settleable, preferably phrased as yes/no questions.`;
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
