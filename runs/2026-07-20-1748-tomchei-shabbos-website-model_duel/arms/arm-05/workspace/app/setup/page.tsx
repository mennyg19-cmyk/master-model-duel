"use client";

import { useState } from "react";

export default function SetupPage() {
  const [message, setMessage] = useState("");

  async function submitSetup(formData: FormData) {
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    const body = await response.json();
    setMessage(response.ok ? `Manager created: ${body.manager.email}` : body.error);
  }

  return (
    <main>
      <p className="eyebrow">Secure setup</p>
      <h1>Create the first Manager</h1>
      <div className="card">
        <form action={submitSetup}>
          <label htmlFor="displayName">Name</label>
          <input id="displayName" name="displayName" required />
          <button className="button" type="submit">Create Manager</button>
        </form>
        {message && <p role="status" className={message.startsWith("Manager") ? "" : "error"}>{message}</p>}
      </div>
    </main>
  );
}
