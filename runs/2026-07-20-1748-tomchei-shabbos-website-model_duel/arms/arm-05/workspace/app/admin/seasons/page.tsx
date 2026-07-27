"use client";

import { FormEvent, useEffect, useState } from "react";

type Season = { id: string; name: string; year: number; status: "OPEN" | "CLOSED"; opensAt: string | null };
type Product = { id: string; name: string; isActive: boolean; season: { name: string; year: number } };
type SeasonState = { seasons: Season[]; products: Product[] };

export default function SeasonsAdminPage() {
  const [state, setState] = useState<SeasonState>({ seasons: [], products: [] });
  const [message, setMessage] = useState("Loading seasons…");
  const [sourceProductId, setSourceProductId] = useState("");
  const [targetProductId, setTargetProductId] = useState("");
  const [targetSeasonId, setTargetSeasonId] = useState("");
  const [sourceOrderId, setSourceOrderId] = useState("");
  const [customerIds, setCustomerIds] = useState("");

  async function load() {
    const response = await fetch("/api/admin/seasons");
    const body = await response.json() as SeasonState & { error?: string };
    if (!response.ok) return setMessage(body.error ?? "Unable to load seasons.");
    setState(body);
    setTargetSeasonId((current) => current || body.seasons.find((season) => season.status === "OPEN")?.id || "");
    setMessage("");
  }

  useEffect(() => { void load(); }, []);

  async function post(body: unknown) {
    const response = await fetch("/api/admin/seasons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Season changes saved." : result.error ?? "Unable to save season changes.");
    if (response.ok) await load();
  }

  async function createSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post({
      action: "create",
      name: form.get("name"),
      year: Number(form.get("year")),
      opensAt: form.get("opensAt") ? new Date(String(form.get("opensAt"))).toISOString() : undefined,
    });
  }

  async function repeat(action: "single" | "bulk") {
    const body = action === "single"
      ? { action, sourceOrderId, targetSeasonId }
      : { action, customerIds: customerIds.split(",").map((customerId) => customerId.trim()).filter(Boolean), targetSeasonId };
    const response = await fetch("/api/admin/repeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { draftId?: string; created?: number; error?: string };
    setMessage(response.ok ? action === "single" ? `Repeat draft ${result.draftId} is ready for staff review.` : `${result.created} repeat drafts are ready for staff review.` : result.error ?? "Unable to create repeat drafts.");
  }

  return (
    <>
      <p className="eyebrow">Season lifecycle</p>
      <h1>Open seasons and map replacements</h1>
      <p className="lead">Prepare next year&apos;s catalog before opening it. Repeat orders always pause for a replacement and recipient review.</p>
      <section className="card ops-list">
        <h2>Seasons</h2>
        {state.seasons.map((season) => <div className="ops-row" key={season.id}>
          <span>{season.name} · {season.status}{season.opensAt ? ` · scheduled ${new Date(season.opensAt).toLocaleString()}` : ""}</span>
          <button className="button secondary" onClick={() => void post({ action: "update", seasonId: season.id, status: season.status === "OPEN" ? "CLOSED" : "OPEN" })} type="button">{season.status === "OPEN" ? "Close season" : "Open season"}</button>
        </div>)}
      </section>
      <section className="card">
        <h2>New-season setup</h2>
        <form onSubmit={createSeason}>
          <label>Name<input name="name" placeholder="Purim 2027" required /></label>
          <label>Year<input min="2020" name="year" required type="number" /></label>
          <label>Scheduled opening (optional)<input name="opensAt" type="datetime-local" /></label>
          <button className="button" type="submit">Create closed season</button>
        </form>
      </section>
      <section className="card">
        <h2>Replacement mappings</h2>
        <p>Map an older item to a later-season product. The repeat flow follows chains across years and chooses the closest-priced mapped option first.</p>
        <label>Discontinued item<select onChange={(event) => setSourceProductId(event.target.value)} value={sourceProductId}><option value="">Choose older item</option>{state.products.map((product) => <option key={product.id} value={product.id}>{product.season.year} · {product.name}</option>)}</select></label>
        <label>Replacement<select onChange={(event) => setTargetProductId(event.target.value)} value={targetProductId}><option value="">Choose later-season item</option>{state.products.filter((product) => product.isActive).map((product) => <option key={product.id} value={product.id}>{product.season.year} · {product.name}</option>)}</select></label>
        <button className="button" disabled={!sourceProductId || !targetProductId} onClick={() => void post({ action: "map", sourceProductId, targetProductId })} type="button">Save replacement mapping</button>
      </section>
      <section className="card">
        <h2>Staff repeat</h2>
        <label>Target open season<select onChange={(event) => setTargetSeasonId(event.target.value)} value={targetSeasonId}><option value="">Choose season</option>{state.seasons.filter((season) => season.status === "OPEN").map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
        <label>Single source order ID<input onChange={(event) => setSourceOrderId(event.target.value)} value={sourceOrderId} /></label>
        <button className="button secondary" disabled={!sourceOrderId || !targetSeasonId} onClick={() => void repeat("single")} type="button">Create one repeat draft</button>
        <label>Bulk customer IDs (comma-separated)<textarea onChange={(event) => setCustomerIds(event.target.value)} value={customerIds} /></label>
        <button className="button secondary" disabled={!customerIds || !targetSeasonId} onClick={() => void repeat("bulk")} type="button">Create bulk repeat drafts</button>
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
