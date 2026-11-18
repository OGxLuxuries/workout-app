import { useEffect, useState } from "react";
import { request } from "./workspace-api";

const products = ["Workers", "D1", "R2", "Observability"] as const;
type Entry = { month: string; product: string; cents: number; note: string };
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function CloudflareCosts() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [product, setProduct] = useState<string>(products[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const path = "/admin/costs";

  async function refresh() {
    const data = await request<{ entries: Entry[] }>(path);
    setEntries(data.entries);
    setLoaded(true);
  }
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);
  const monthly = entries.filter((entry) => entry.month === month);
  return (
    <section className="card workspace-form">
      <h2>Cloudflare costs</h2>
      <p>
        Record the portion of each monthly Cloudflare charge attributable to
        Workout Competition. Leave shared charges blank until you can allocate
        them. Domain registration and renewal are excluded.
      </p>
      <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">
        Open Cloudflare dashboard
      </a>
      <label>
        Billing month
        <input
          type="month"
          required
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {loaded && (
        <>
          <p>
            {monthly.length
              ? "Recorded monthly total " +
                usd.format(
                  monthly.reduce((total, entry) => total + entry.cents, 0) /
                    100,
                )
              : "No costs recorded for this month."}
          </p>
          <ul>
            {monthly.map((entry) => (
              <li key={entry.product}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setProduct(entry.product);
                    setAmount((entry.cents / 100).toFixed(2));
                    setNote(entry.note);
                  }}
                >
                  {entry.product} · {usd.format(entry.cents / 100)}
                </button>
                {entry.note && <p>{entry.note}</p>}
              </li>
            ))}
          </ul>
          <form
            className="workspace-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setStatus("");
              try {
                await request(path, {
                  month,
                  product,
                  cents: Math.round(Number(amount) * 100),
                  note,
                });
                await refresh();
                setAmount("");
                setNote("");
                setStatus("Cost saved.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Cloudflare service
              <select
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                {products.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              App cost (USD)
              <input
                type="number"
                required
                min="0"
                max="1000000"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Invoice or allocation note
              <input
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !month}>
              Save monthly cost
            </button>
          </form>
        </>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
