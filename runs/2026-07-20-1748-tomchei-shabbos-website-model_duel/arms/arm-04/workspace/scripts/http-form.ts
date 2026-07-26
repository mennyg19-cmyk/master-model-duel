/**
 * A cookie jar plus a parser for Next.js server-action forms.
 *
 * Server actions rendered by `<form action={fn}>` work without JavaScript: the
 * HTML carries `$ACTION_*` hidden inputs and posts back to the same URL. The
 * smoke harness replays exactly that, so it exercises the real action pipeline
 * rather than calling library functions behind the UI's back.
 */

export type ParsedForm = {
  action: string;
  fields: Record<string, string>;
  html: string;
};

export class Session {
  private readonly cookies = new Map<string, string>();

  constructor(readonly baseUrl: string) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), cookie: this.cookieHeader() },
    });

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value === '' || raw.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    return response;
  }

  async get(path: string): Promise<{ status: number; body: string }> {
    const response = await this.request(path);
    return { status: response.status, body: await response.text() };
  }

  /** Submits a rendered server-action form, adding or overriding named values. */
  async submit(form: ParsedForm, values: Record<string, string> = {}): Promise<Response> {
    const body = new FormData();
    for (const [name, value] of Object.entries({ ...form.fields, ...values })) {
      body.append(name, value);
    }
    return this.request(form.action, { method: 'POST', body });
  }

  clearCookies() {
    this.cookies.clear();
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export function parseForms(html: string, pageUrl: string): ParsedForm[] {
  const forms: ParsedForm[] = [];

  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const actionAttribute = /action="([^"]*)"/.exec(match[1])?.[1] ?? '';
    const fields: Record<string, string> = {};

    for (const input of match[2].matchAll(/<input\b([^>]*)>/g)) {
      const name = /name="([^"]*)"/.exec(input[1])?.[1];
      if (!name) continue;
      fields[decodeEntities(name)] = decodeEntities(/value="([^"]*)"/.exec(input[1])?.[1] ?? '');
    }

    forms.push({
      action: actionAttribute === '' ? pageUrl : actionAttribute,
      fields,
      html: match[2],
    });
  }

  return forms;
}

/** Finds the one form whose hidden fields match every entry in `criteria`. */
export function findForm(forms: ParsedForm[], criteria: Record<string, string>): ParsedForm {
  const matches = forms.filter((form) =>
    Object.entries(criteria).every(([name, value]) => form.fields[name] === value),
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one form matching ${JSON.stringify(criteria)}, found ${matches.length}.`,
    );
  }

  return matches[0];
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}
