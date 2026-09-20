export function safeReturnPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return "/";
  const origin = "https://app.example";
  try {
    const parsed = new URL(value, origin);
    return parsed.origin === origin
      ? parsed.pathname + parsed.search + parsed.hash
      : "/";
  } catch {
    return "/";
  }
}
