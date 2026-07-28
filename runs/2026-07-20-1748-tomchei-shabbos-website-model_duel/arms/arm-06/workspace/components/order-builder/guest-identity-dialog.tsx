"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface GuestIdentity {
  name: string;
  email: string;
  phone: string | null;
}

// Guests hand over identity once, at checkout: the draft becomes a server
// draft and the access token comes back in an httpOnly cookie (R-023).
export function GuestIdentityDialog({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (identity: GuestIdentity) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <Dialog label="Your details for checkout" onClose={onClose} panelClassName="max-w-md">
      <h2 className="text-lg font-semibold text-stone-900">Almost there</h2>
      <p className="mt-1 text-sm text-stone-600">
        We&apos;ll save this order under your email so you can come back to it.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <label className="text-sm text-stone-700">
          Your name
          <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" data-guest-name />
        </label>
        <label className="text-sm text-stone-700">
          Email
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1"
            data-guest-email
          />
        </label>
        <label className="text-sm text-stone-700">
          Phone (optional)
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1" />
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
        <Button
          disabled={busy || !name.trim() || !email.trim()}
          onClick={() => onSubmit({ name: name.trim(), email: email.trim(), phone: phone.trim() || null })}
          data-guest-submit
        >
          {busy ? "Saving…" : "Continue to checkout"}
        </Button>
      </div>
    </Dialog>
  );
}
