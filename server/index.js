import "dotenv/config";
import cors from "cors";
import express from "express";
import { findLiveMarkets } from "./anakin.js";
import { planConcernWithGemini } from "./gemini.js";
import { computeHedge, scoreMarket } from "./hedgeMath.js";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175", "http://127.0.0.1:5176"] }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    anakinConfigured: Boolean(process.env.ANAKIN_API_KEY),
    liveEnabled: process.env.ANAKIN_USE_LIVE === "true",
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

async function handleHedgeRequest(input, res) {
  const concern = String(input.concern || "").trim();
  const category = String(input.category || inferCategory(concern));
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
    console.log("[HEDGE] Step 1: Calling Gemini for search planning...");
    const aiPlan = await planConcernWithGemini({ concern, category, signal: controller.signal }).catch(() => null);
    if (aiPlan) {
      console.log(`[HEDGE]   OK Gemini returned ${aiPlan.searchQueries.length} search queries and ${aiPlan.suggestedBets.length} suggested bets`);
    } else {
      console.log("[HEDGE]   Gemini returned null (API key issue or disabled)");
    }

    const searchQueries = [concern, ...localSearchQueries(concern), ...(aiPlan?.searchQueries || [])]
      .filter((item, index, list) => item && list.indexOf(item) === index)
      .slice(0, 5);
    
    console.log(`[HEDGE] Step 2: Built ${searchQueries.length} search queries`);
    console.log(`[HEDGE]   Queries: ${searchQueries.map(q => `"${q}"`).join(", ")}`);

    console.log("[HEDGE] Step 3: Calling live market providers...");
    const live = await findLiveMarkets({
      query: searchQueries[0],
      queries: searchQueries,
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
      category,
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
  if (/flight|airport|airline|hotel|summit|conference|trip|travel|vacation/.test(text)) return "Travel";
  if (/gas|fuel|commute|drive|traffic|rideshare|uber|lyft|train|transit/.test(text)) return "Commute";
  if (/bill|rent|electric|utility|energy|power|natural gas/.test(text)) return "Bills";
  if (/grocery|groceries|food|cpi|inflation/.test(text)) return "Groceries";
  return "Weather";
}

function localSearchQueries(concern) {
  const text = String(concern || "").toLowerCase();
  const queries = [];

  if (/measles/.test(text)) queries.push("measles");
  if (/sfo|flight|airport|airline|delay/.test(text)) queries.push("flight delays");
  if (/sjc|san jose/.test(text)) queries.push("San Jose");
  if (/silicon valley|bay area|summit|conference/.test(text)) queries.push("Bay Area weather", "SFO flight delays");
  if (/gas|fuel/.test(text)) queries.push("gas prices");
  if (/inflation|grocery|food/.test(text)) queries.push("inflation");

  return queries;
}
