import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLiveMarkets } from "./anakin.js";
import { planConcernWithGemini } from "./gemini.js";
import { computeHedge, scoreMarket } from "./hedgeMath.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175", "http://127.0.0.1:5176"] }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    anakinConfigured: Boolean(process.env.ANAKIN_API_KEY),
    liveEnabled: process.env.ANAKIN_USE_LIVE === "true",
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    oddspipeConfigured: Boolean(process.env.ODDSPIPE_API_KEY)
  });
});

app.get("/api/headges", (_req, res) => {
  res.redirect(307, "/api/hedges");
});

app.post("/api/headges", (req, res) => {
  req.url = "/api/hedges";
  app.handle(req, res);
});

app.get("/api/hedges", async (req, res) => {
  await handleHedgeRequest(
    {
      concern: req.query.concern || "Heavy rain in Cancun from May 20-24 that ruins our beach vacation.",
      category: req.query.category || "Weather",
      badOutcomeCost: req.query.badOutcomeCost || 2000
    },
    res
  );
});

app.post("/api/hedges", async (req, res) => {
  await handleHedgeRequest(req.body, res);
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

async function handleHedgeRequest(input, res) {
  const concern = String(input.concern || "").trim();
  const fallbackCategory = inferCategory(concern);
  const category = String(input.category || fallbackCategory);
  const badOutcomeCost = Number(input.badOutcomeCost || 2000);

  console.log(`\n[HEDGE] Processing concern: "${concern.substring(0, 60)}${concern.length > 60 ? "..." : ""}"`);
  console.log(`[HEDGE] Category: ${category}, Cost: $${badOutcomeCost}`);

  if (!concern) {
    res.status(400).json({ error: "Tell us what you are worried about first." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    console.log("[HEDGE] Step 1: Calling AI planner for search planning...");
    const aiPlan = await planConcernWithGemini({ concern, category, signal: controller.signal }).catch(() => null);
    if (aiPlan) {
      console.log(
        `[HEDGE]   OK Gemini returned ${aiPlan.searchQueries.length} search queries, ${aiPlan.providerQueries.oddspipe.length} Oddspipe queries, and ${aiPlan.suggestedBets.length} suggested bets`
      );
    } else {
      console.log("[HEDGE]   Gemini returned null (API key issue or disabled)");
    }

    const fallbackQueries = fallbackSearchQueries(concern);
    const providerQueries = aiPlan?.providerQueries || {};
    const searchQueries = uniqueQueries([
      ...(aiPlan?.searchQueries || []),
      ...Object.values(providerQueries).flat(),
      concern,
      ...fallbackQueries
    ]).slice(0, 7);
    const oddspipeQueries = uniqueQueries([
      ...(providerQueries.oddspipe || []),
      ...(aiPlan?.searchQueries || []),
      concern,
      ...fallbackQueries
    ]).slice(0, 8);
    
    console.log(`[HEDGE] Step 2: Built ${searchQueries.length} search queries`);
    console.log(`[HEDGE]   Queries: ${searchQueries.map(q => `"${q}"`).join(", ")}`);

    console.log("[HEDGE] Step 3: Calling live market providers...");
    const live = await findLiveMarkets({
      query: searchQueries[0],
      queries: searchQueries,
      oddspipeQueries,
      category: aiPlan?.category || category,
      signal: controller.signal
    });
    
    console.log(`[HEDGE]   Source: ${live.source}`);
    console.log(`[HEDGE]   Markets found: ${live.markets.length}`);
    console.log(`[HEDGE]   Reason: ${live.reason}`);

    const ranked = live.markets
      .map((market) => ({ ...computeHedge(market, badOutcomeCost), score: scoreMarket(market, concern, category) }))
      .sort((a, b) => sourcePriority(a) - sourcePriority(b) || b.score - a.score || b.probability - a.probability)
      .slice(0, 6);

    console.log(`[HEDGE] Step 4: Computed hedge math and ranked ${ranked.length} markets`);
    const suggestedBets = ranked.length === 0 ? aiPlan?.suggestedBets || [] : [];
    console.log("[HEDGE] SUCCESS: Returning response");
    console.log(`[HEDGE]   Response source: ${live.source}`);
    console.log(`[HEDGE]   Final markets: ${ranked.length}`);
    console.log(`[HEDGE]   Gemini suggested bets: ${suggestedBets.length}`);

    res.json({
      source: live.source,
      sourceMessage: live.reason,
      concern,
      category: aiPlan?.category || category,
      searchQueries,
      badOutcomeCost,
      markets: ranked,
      suggestedBets,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.log(`[HEDGE] ERROR: ${error.message}`);
    console.log(`[HEDGE]   Stack: ${error.stack?.split("\n")[1]?.trim()}`);
    res.json({
      source: "none",
      sourceMessage: `Live market search failed: ${error.message}`,
      concern,
      category,
      badOutcomeCost,
      searchQueries: [concern],
      markets: [],
      suggestedBets: [],
      generatedAt: new Date().toISOString()
    });
  } finally {
    clearTimeout(timeout);
  }
}

const server = app.listen(port, () => {
  console.log(`\nHedge My Life API listening on http://127.0.0.1:${port}`);
  console.log("\nAPI Configuration:");
  console.log(`   - ANAKIN live markets: ${process.env.ANAKIN_USE_LIVE === "true" ? "ENABLED" : "DISABLED"}`);
  console.log(`   - ANAKIN API key: ${process.env.ANAKIN_API_KEY ? "SET" : "MISSING"}`);
  console.log(`   - Oddspipe API key: ${process.env.ODDSPIPE_API_KEY ? "SET" : "MISSING"}`);
  console.log(`   - OpenRouter planner: ${process.env.OPENROUTER_API_KEY ? "ENABLED" : "DISABLED"}`);
  console.log(`   - Gemini query planner: ${process.env.GEMINI_API_KEY ? "ENABLED" : "DISABLED"}`);
  console.log("\nReady to return real markets from Kalshi, Polymarket, Robinhood, and Oddspipe.\n");
});

server.on("error", (error) => {
  console.error(`[HEDGE] Server failed to start: ${error.message}`);
  process.exitCode = 1;
});

function sourcePriority(market) {
  if (market.sourceType === "search") return 0;
  if (market.sourceType === "detail") return 1;
  return 2;
}

function inferCategory(concern) {
  const text = String(concern || "").toLowerCase();
  if (/bitcoin|crypto|ethereum|btc|reserve/.test(text)) return "Crypto";
  if (/measles|covid|flu|disease|cases|health/.test(text)) return "Health";
  if (/fed chair|election|trump|biden|congress|president|policy/.test(text)) return "Politics";
  if (/recession|unemployment|rate cut|interest rate|inflation|cpi|fed|oil|stock|s&p|market/.test(text)) return "Economy";
  if (/flight|airport|airline|hotel|summit|conference|trip|travel|vacation/.test(text)) return "Travel";
  if (/gas|fuel|commute|drive|traffic|rideshare|uber|lyft|train|transit/.test(text)) return "Commute";
  if (/bill|rent|electric|utility|energy|power|natural gas/.test(text)) return "Bills";
  if (/grocery|groceries|food|egg|eggs/.test(text)) return "Groceries";
  if (/rain|snow|storm|weather|temperature|hurricane|air quality/.test(text)) return "Weather";
  return "Other";
}

function fallbackSearchQueries(concern) {
  const text = String(concern || "");
  const normalized = text
    .replace(/\bU\.S\.\b/gi, "US")
    .replace(/[^a-zA-Z0-9\s$.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length > 2 && !fallbackStopWords.has(token.toLowerCase()));
  const namedPairs = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = `${tokens[index]} ${tokens[index + 1]}`;
    if (/[A-Z0-9$]/.test(pair)) namedPairs.push(pair);
  }

  return uniqueQueries([
    tokens.slice(0, 5).join(" "),
    ...namedPairs.slice(0, 3),
    tokens.slice(-4).join(" ")
  ]).filter((query) => query.split(" ").length >= 2);
}

function uniqueQueries(items) {
  const seen = new Set();
  return items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const fallbackStopWords = new Set([
  "will",
  "would",
  "could",
  "should",
  "make",
  "more",
  "less",
  "than",
  "there",
  "with",
  "from",
  "this",
  "that",
  "what",
  "when",
  "where",
  "between",
  "about",
  "have",
  "create",
  "created",
  "happen",
  "happens",
  "expensive",
  "worried"
]);
