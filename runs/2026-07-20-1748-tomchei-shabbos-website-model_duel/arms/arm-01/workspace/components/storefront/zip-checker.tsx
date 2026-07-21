"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Pre-order delivery check against the live delivery-ZIP list (G-014
 * groundwork). The API reads settings fresh every request, so an admin edit
 * applies immediately.
 */
export function ZipChecker() {
  const [zip, setZip] = useState("");
  const [verdict, setVerdict] = useState<{ deliverable: boolean; zip: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setVerdict(null);
    const response = await fetch(`/api/delivery-zips/check?zip=${encodeURIComponent(zip)}`);
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Could not check that ZIP.");
      return;
    }
    setVerdict(body);
  }

  return (
    <form onSubmit={check} className="mt-4">
      <label htmlFor="zip-check" className="block text-sm font-medium">
        Do we deliver to your recipient?
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id="zip-check"
          value={zip}
          onChange={(event) => setZip(event.target.value)}
          placeholder="5-digit ZIP"
          inputMode="numeric"
          maxLength={5}
          className="w-32"
        />
        <Button type="submit">Check</Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {verdict && (
        <p className={`mt-2 text-sm font-medium ${verdict.deliverable ? "text-success" : "text-danger"}`} data-testid="zip-verdict">
          {verdict.deliverable
            ? `Yes! We deliver to ${verdict.zip}.`
            : `Sorry, ${verdict.zip} is outside our delivery area. Shipping will be available at checkout.`}
        </p>
      )}
    </form>
  );
}
