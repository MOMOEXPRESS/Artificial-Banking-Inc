/** Workers supports manual/follow, but rejects Fetch's redirect:"error". */
export async function privyFetch(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.origin !== "https://api.privy.io")
    throw new Error("Privy request origin is not allowed.");
  const response = await fetcher(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("Privy returned an unexpected redirect.");
  }
  return response;
}
