import React, { useMemo, useState } from "react";
import {
  BookIcon,
  ClockIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  UmbrellaIcon
} from "./icons.jsx";

const defaultMarkets = [];

export default function App() {
  const [concern, setConcern] = useState("Heavy rain in Cancun from May 20-24 that ruins our beach vacation.");
  const [badOutcomeCost, setBadOutcomeCost] = useState(2000);
  const [markets, setMarkets] = useState(defaultMarkets);
  const [selectedId, setSelectedId] = useState(defaultMarkets[0]?.id);
  const [source, setSource] = useState("none");
  const [sourceMessage, setSourceMessage] = useState("Ready to search real Kalshi, Polymarket, and Robinhood markets.");
  const [suggestedBets, setSuggestedBets] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const selectedMarket = useMemo(
    () => markets.find((market) => market.id === selectedId) || markets[0],
    [markets, selectedId]
  );

  async function findHedges() {
    setIsLoading(true);
    setSourceMessage("Scanning Kalshi, Polymarket, and Robinhood actions through the Node API...");

    try {
      const response = await fetch("http://127.0.0.1:8787/api/hedges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concern, badOutcomeCost })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not find hedges");

      setMarkets(payload.markets);
      setSelectedId(payload.markets[0]?.id);
      setSuggestedBets(payload.suggestedBets || []);
      setSource(payload.source);
      setSourceMessage(payload.sourceMessage);
    } catch (error) {
      setSource("offline");
      setSourceMessage(`${error.message}. Start the Node server with npm run server.`);
      setSuggestedBets([]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <Header source={source} />

      <section className="workspace">
        <ConcernPanel
          concern={concern}
          setConcern={setConcern}
          badOutcomeCost={badOutcomeCost}
          setBadOutcomeCost={setBadOutcomeCost}
          isLoading={isLoading}
          onFind={findHedges}
        />
        <MarketsPanel
          markets={markets}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          sourceMessage={sourceMessage}
          suggestedBets={suggestedBets}
          isLoading={isLoading}
        />
      </section>

      <HedgeMath market={selectedMarket} badOutcomeCost={badOutcomeCost} />
    </main>
  );
}

function Header({ source }) {
  const isLive = source === "anakin";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><UmbrellaIcon /></span>
        <span>Hedge My Life</span>
      </div>
      <div className="market-status">
        <span className={isLive ? "dot online" : "dot"} />
        {isLive ? "Live market matches" : "No live matches yet"}
      </div>
      <nav className="topnav" aria-label="Product">
        <a href="#math"><BookIcon /> How it works</a>
        <a href="#recent"><ClockIcon /> Recent hedges</a>
      </nav>
    </header>
  );
}

function ConcernPanel(props) {
  const {
    concern,
    setConcern,
    badOutcomeCost,
    setBadOutcomeCost,
    isLoading,
    onFind
  } = props;

  return (
    <section className="panel concern-panel" aria-labelledby="concern-title">
      <StepLabel number="1" />
      <h1 id="concern-title">What are you worried about today?</h1>
      <p className="helper">Describe the event and we will find prediction markets that can hedge it.</p>

      <label className="sr-only" htmlFor="concern-input">Concern</label>
      <textarea
        id="concern-input"
        value={concern}
        onChange={(event) => setConcern(event.target.value)}
        maxLength={500}
      />
      <div className="char-count">{concern.length}/500</div>

      <label className="field-label" htmlFor="cost-range">
        How much would this cost you?
      </label>
      <div className="cost-row">
        <strong>{formatCurrency(badOutcomeCost)}</strong>
        <input
          id="cost-range"
          type="range"
          min="500"
          max="10000"
          step="100"
          value={badOutcomeCost}
          onChange={(event) => setBadOutcomeCost(Number(event.target.value))}
        />
      </div>
      <div className="range-labels">
        <span>$500</span><span>$2,000</span><span>$5,000</span><span>$10,000+</span>
      </div>
      <p className="fine-print">Use your best estimate of the total expense, disappointment, or both.</p>

      <button className="primary-action" onClick={onFind} type="button" disabled={isLoading}>
        <SearchIcon /> {isLoading ? "Finding hedges" : "Find hedges"}
      </button>

      <div className="privacy-note">
        <ShieldIcon />
        <p><strong>Your privacy matters.</strong> Your key stays on the Node server and concern text is only used for market search.</p>
      </div>
    </section>
  );
}

function MarketsPanel({ markets, selectedId, setSelectedId, sourceMessage, suggestedBets, isLoading }) {
  return (
    <section className="panel market-panel" aria-labelledby="market-title">
      <div className="panel-head">
        <div>
          <StepLabel number="2" />
          <h2 id="market-title">Matched markets</h2>
          <p className="helper">Contracts that can pay out if your worried outcome happens.</p>
        </div>
        <div className="toolbar">
          <button type="button">Show&nbsp; Best matches</button>
          <button type="button"><SlidersIcon /> Filters</button>
        </div>
      </div>

      <div className={`results-grid ${suggestedBets.length > 0 ? "with-ideas" : ""}`}>
        <div className="table-wrap" aria-busy={isLoading}>
          <table>
            <thead>
              <tr>
                <th>Market / Contract</th>
                <th>Platform</th>
                <th>Event date</th>
                <th>Odds</th>
                <th>Yes price</th>
                <th>Rec. hedge</th>
                <th>Confidence</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 ? (
                <tr>
                  <td className="empty-cell" colSpan="8">
                    No real Kalshi, Polymarket, or Robinhood markets matched this concern. Gemini ideas appear separately as markets someone could create.
                  </td>
                </tr>
              ) : markets.map((market) => (
                <tr
                  key={market.id}
                  className={market.id === selectedId ? "active-row" : ""}
                  onClick={() => setSelectedId(market.id)}
                >
                  <td>
                    <strong>{market.title}</strong>
                    <span>{sourceTypeLabel(market)}{market.description}</span>
                  </td>
                  <td><span className={`platform ${market.platform.toLowerCase()}`}>{market.platform}</span></td>
                  <td>{market.eventDate}</td>
                  <td>{Math.round(market.probability * 100)}%</td>
                  <td>{Math.round(market.yesPrice * 100)}c</td>
                  <td>
                    <strong>{formatCurrency(market.recommendedAmount)}</strong>
                    <span>{market.shares} shares</span>
                  </td>
                  <td><span className={`confidence ${market.confidence.toLowerCase()}`}>{market.confidence}</span></td>
                  <td>
                    <a
                      className="market-link"
                      href={market.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {suggestedBets.length > 0 && (
          <aside className="idea-column" aria-label="Gemini suggested bets">
            <div className="idea-head">
              <strong>Gemini bet ideas</strong>
              <span>Not live markets</span>
            </div>
            {suggestedBets.map((bet) => (
              <article className="idea-card" key={bet.id}>
                <span className="idea-platform">{bet.platformFit}</span>
                <h3>{bet.title}</h3>
                <p>{bet.description}</p>
                <dl>
                  <div>
                    <dt>Window</dt>
                    <dd>{bet.eventWindow}</dd>
                  </div>
                  <div>
                    <dt>Settlement</dt>
                    <dd>{bet.settlementSource}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </aside>
        )}
      </div>

      <footer className="table-foot">
        <span>{sourceMessage}</span>
        <button type="button">View more markets</button>
      </footer>
    </section>
  );
}

function HedgeMath({ market, badOutcomeCost }) {
  if (!market) return null;

  return (
    <section className="panel math-panel" id="math" aria-labelledby="math-title">
      <div className="math-title-row">
        <div>
          <StepLabel number="3" />
          <h2 id="math-title">Hedge math</h2>
          <p>{market.title} <span>{market.platform}</span></p>
        </div>
        <a href="https://anakin.io/llms-full.txt" target="_blank" rel="noreferrer">Anakin docs</a>
      </div>

      <div className="math-strip">
        <Metric label="Estimated bad outcome cost" value={formatCurrency(badOutcomeCost)} sub="Your input" />
        <Operator value="x" />
        <Metric label="Contract probability" value={`${Math.round(market.probability * 100)}%`} sub="Market odds" />
        <Operator value="x" />
        <Metric label="Shares" value={market.shares.toLocaleString()} sub="$1.00 per share" />
        <Operator value="x" />
        <Metric label="Yes price" value={`$${market.yesPrice.toFixed(2)}`} sub={`${Math.round(market.yesPrice * 100)}c`} />
        <Operator value="=" />
        <Metric label="Max loss" value={formatCurrency(market.premium)} sub="Premium paid" />
        <Operator value="->" />
        <Metric highlight label="Potential payout if it happens" value={formatCurrency(market.netIfBad)} sub={`${market.coverage}% of your cost`} />
      </div>

      <footer className="math-foot">
        <span><ShieldIcon /> Payouts are not guaranteed. If the outcome does not occur, you lose the premium.</span>
        <button type="button"><SlidersIcon /> Adjust shares</button>
      </footer>
    </section>
  );
}

function Metric({ label, value, sub, highlight }) {
  return (
    <div className={`metric ${highlight ? "highlight" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function Operator({ value }) {
  return <div className="operator" aria-hidden="true">{value}</div>;
}

function StepLabel({ number }) {
  return <span className="step">{number}</span>;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function sourceTypeLabel(market) {
  if (market.sourceType === "search") return "Search Markets result: ";
  if (market.sourceType === "detail") return "Market detail: ";
  if (market.sourceType === "live") return "Live listing: ";
  return "";
}
