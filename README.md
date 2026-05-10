# Hedge My Life

Hedge My Life is a hackathon project that turns prediction markets into a simple, consumer-facing hedge calculator.

Instead of showing a trading dashboard, the app asks: "What are you worried about today?" A user describes an everyday risk, such as gas prices, travel delays, recession risk, disease case counts, or weather disruption. The backend searches live prediction market providers, finds relevant contracts, and calculates how much the user would need to buy to offset a chosen bad-outcome cost.

This is not financial advice. It is a prototype for explaining how prediction markets could act like informal insurance for small, specific worries.

Live deployment: https://whale-app-w5awy.ondigitalocean.app/

Health check: https://whale-app-w5awy.ondigitalocean.app/api/health

## Screenshots

![Hedge My Life homepage](https://github.com/user-attachments/assets/64b4c6bd-23ff-4af5-b8cc-8a3459be1bfb)

![Hedge My Life results](https://github.com/user-attachments/assets/31b05c34-dd2a-45dd-946d-288e2bdfd6a0)

## Features

- React + Vite frontend with a simple concern input and hedge math view.
- Node + Express API for provider calls and hedge calculations.
- OpenRouter query planning to convert natural-language worries into market search terms, with Gemini as a fallback.
- Live provider search through:
  - Anakin Wire for Polymarket, Robinhood, and Kalshi.
  - Oddspipe market search for additional prediction market coverage.
- Separate AI-generated bet ideas when no live market exists.
- Direct links to live markets where provider URLs are available.
- No hardcoded fake market rows in the active app path.

## How It Works

1. The user enters a worry and estimated bad-outcome cost.
2. OpenRouter maps the worry into focused search queries. Gemini is used as a fallback planner if configured.
3. The backend searches live providers:
   - Polymarket via `pm_search_markets`, then market detail calls.
   - Robinhood via `rh_get_markets`, then `rh_get_event`.
   - Kalshi via `kl_events` with nested markets.
4. Results are normalized into one market shape.
5. The app filters out closed, irrelevant, missing-price, and bad substring matches.
6. Hedge math estimates shares, premium, payout, and coverage.
7. If no real market matches, AI-created market ideas appear separately as non-live suggestions.

## Environment

Create a `.env` file in the project root:

```env
PORT=8787
ANAKIN_API_KEY=your_anakin_key
ANAKIN_USE_LIVE=true
ANAKIN_BASE_URL=https://api.anakin.io/v1
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-flash-latest
ODDSPIPE_API_KEY=your_oddspipe_key
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=openai/gpt-4.1-mini
```

Keep `.env` private. `.env.example` shows the required variable names without secrets.

OpenRouter is the primary planner and uses the OpenAI-compatible chat completions endpoint:

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer $OPENROUTER_API_KEY
Content-Type: application/json
```

Gemini remains available as a fallback and uses the same REST shape as the Google example:

```http
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent
Content-Type: application/json
X-goog-api-key: $GEMINI_API_KEY
```

## Run Locally

Install dependencies:

```bash
npm install
```

Run frontend and backend together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run server
npm run client
```

Open:

- Frontend: http://127.0.0.1:5173/
- API health: http://127.0.0.1:8787/api/health

## Useful Demo Queries

These are good starting points because they commonly map to live market data:

- `measles cases in the U.S. in 2026`
- `Will there be at least 3000 measles cases in the U.S. in 2026?`
- `gas prices`
- `recession this year`

Weather queries can be sparse because many prediction markets do not list local weather contracts. For travel worries, use specific proxy terms such as:

- `SFO delays`
- `Bay Area rain`
- `San Jose temperature`
- `air quality`

For open-ended questions like `how will my trip be between May 20-21?`, the AI planner expands the concern into possible hedgeable risks based on the location, dates, and activity:

- airport and airline delays
- local rain or storms
- local temperature extremes
- air quality
- local transit or rideshare disruption
- major local event congestion
- lodging, fuel, or demand spikes when relevant

## API

Health:

```http
GET /api/health
```

Find hedges:

```http
POST /api/hedges
Content-Type: application/json

{
  "concern": "gas prices",
  "badOutcomeCost": 2000
}
```

Response shape:

```json
{
  "source": "anakin",
  "sourceMessage": "Live markets returned from Kalshi, Polymarket, Robinhood, or Oddspipe.",
  "concern": "gas prices",
  "category": "Commute",
  "searchQueries": ["gas prices"],
  "badOutcomeCost": 2000,
  "markets": [],
  "suggestedBets": [],
  "generatedAt": "2026-05-10T00:00:00.000Z"
}
```

`markets` are live provider results. `suggestedBets` are AI-created market ideas and are not live tradable contracts.

## Build

```bash
npm run build
```

## Docker

Build the production image:

```bash
docker build -t hedge-my-life .
```

Run it with your local `.env`:

```bash
docker run --env-file .env -p 8787:8787 hedge-my-life
```

Or use Compose:

```bash
docker compose up --build
```

The container serves both the React frontend and the Express API on the same port:

- App: http://localhost:8787/
- Health: http://localhost:8787/api/health

## DigitalOcean Deployment

Recommended path: DigitalOcean App Platform with the Dockerfile.

1. Push this repo to GitHub.
2. In DigitalOcean, create a new App from the GitHub repo.
3. Choose Dockerfile-based deployment.
4. Set the HTTP port to `8787`.
5. Add these environment variables as encrypted app variables:
   - `PORT=8787`
   - `ANAKIN_API_KEY`
   - `ANAKIN_USE_LIVE=true`
   - `ANAKIN_BASE_URL=https://api.anakin.io/v1`
   - `ODDSPIPE_API_KEY`
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL=openai/gpt-4.1-mini`
   - `GEMINI_API_KEY` only if you want Gemini fallback
   - `GEMINI_MODEL=gemini-flash-latest`
6. Deploy.

In local Vite development, the browser calls `http://127.0.0.1:8787/api/hedges`. In production, the browser calls `/api/hedges` on the same origin, so the deployed app does not need a separate frontend API URL.
