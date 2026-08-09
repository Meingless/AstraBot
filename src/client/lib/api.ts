type ApiErrorBody = { error?: unknown };

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      if (typeof body.error === "string" && body.error) message = body.error;
    } else {
      const body = await response.text().catch(() => "");
      if (body.trim()) message = body.trim();
    }
    throw new Error(message);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}
