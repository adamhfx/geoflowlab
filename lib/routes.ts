export type AppRoute = {
  view: "overview" | "saved" | "catalog" | "editor" | "results" | "billing" | "models" | "settings" | "sales" | "signin";
  preview: boolean;
  calculationId?: string;
  runId?: string;
  calculatorId?: string;
  mode?: "example" | "blank";
  section?: string;
};

// Authentication and billing may attach these parameters to their return page.
export function parsePageRoute(pathname: string, search = ""): AppRoute | null {
  const params = new URLSearchParams(search);
  const extras = pathname === "/" ? ["signin", "error", "plan", "billing"]
    : pathname === "/signin" ? ["next", "error", "plan"]
    : pathname === "/subscription" ? ["plan", "billing"] : [];
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length > 1) return null;
    if (extras.includes(key)) params.delete(key);
  }
  return parseAppRoute(pathname, params.toString());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION = SLUG;

function validId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function validSlug(value: unknown): value is string { return typeof value === "string" && SLUG.test(value); }
function validSection(value: unknown): value is string { return typeof value === "string" && SECTION.test(value); }
function query(search: string) {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const values = new Map<string, string>();
  for (const [key, value] of params) {
    if (values.has(key)) return null;
    values.set(key, value);
  }
  for (const key of values.keys()) if (!["calculator", "mode", "section"].includes(key)) return null;
  return values;
}

export function parseAppRoute(pathname: string, search = ""): AppRoute | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || (pathname.length > 1 && pathname.endsWith("/")) || pathname.includes("\\") || pathname.includes("//") || pathname.includes("#")) return null;
  const parts = pathname.split("/").filter(Boolean);
  const preview = parts[0] === "preview";
  if (preview) parts.shift();
  const q = query(search);
  if (!q) return null;
  const section = q.get("section") || undefined;
  if (section !== undefined && !validSection(section)) return null;
  const calculator = q.get("calculator") || undefined;
  const mode = q.get("mode") || undefined;
  if (calculator !== undefined && !validSlug(calculator)) return null;
  if (mode !== undefined && mode !== "example" && mode !== "blank") return null;
  if (parts.length === 0 && preview) return section || calculator || mode ? null : { view: "overview", preview: true };
  if (parts.length === 0) return section || calculator || mode ? null : { view: "sales", preview: false };
  if (parts.length === 1 && parts[0] === "workspace") return preview || section || calculator || mode ? null : { view: "overview", preview: false };
  if (parts.length === 1 && parts[0] === "calculators") return section || calculator || mode ? null : { view: "catalog", preview };
  if (parts.length === 1 && parts[0] === "calculations") return section || calculator || mode ? null : { view: "saved", preview };
  if (parts.length === 1 && parts[0] === "subscription") return section || calculator || mode ? null : { view: "billing", preview };
  if (parts.length === 1 && parts[0] === "settings") return section || calculator || mode ? null : { view: "settings", preview };
  if (parts.length === 2 && parts[0] === "settings" && parts[1] === "workbooks") return section || calculator || mode ? null : { view: "models", preview };
  if (parts.length === 1 && parts[0] === "signin") return section || calculator || mode ? null : { view: "signin", preview };
  if (parts.length === 2 && parts[0] === "calculations" && parts[1] === "new") {
    if (!calculator || !validSlug(calculator)) return null;
    return { view: "editor", preview, calculatorId: calculator, ...(mode ? { mode: mode as "example" | "blank" } : {}), ...(section ? { section } : {}) };
  }
  if (parts.length === 2 && parts[0] === "calculations" && validId(parts[1])) {
    return calculator || mode ? null : { view: "editor", preview, calculationId: parts[1], ...(section ? { section } : {}) };
  }
  if (parts.length === 3 && parts[0] === "calculations" && validId(parts[1]) && parts[2] === "runs") return null;
  if (parts.length === 4 && parts[0] === "calculations" && validId(parts[1]) && parts[2] === "runs" && validId(parts[3])) {
    return calculator || mode ? null : { view: "results", preview, calculationId: parts[1], runId: parts[3], ...(section ? { section } : {}) };
  }
  return null;
}

export function routeHref(route: AppRoute): string {
  if (!route || typeof route !== "object") throw new Error("Invalid route.");
  const prefix = route.preview ? "/preview" : "";
  let path: string;
  switch (route.view) {
    case "sales": if (route.preview) throw new Error("Sales route has no preview path."); path = "/"; break;
    case "overview": path = route.preview ? "" : "/workspace"; break;
    case "catalog": path = "/calculators"; break;
    case "saved": path = "/calculations"; break;
    case "billing": path = "/subscription"; break;
    case "settings": path = "/settings"; break;
    case "models": path = "/settings/workbooks"; break;
    case "signin": path = "/signin"; break;
    case "editor":
      if (route.calculatorId !== undefined) {
        if (!validSlug(route.calculatorId)) throw new Error("Invalid calculator id.");
        path = "/calculations/new";
      } else if (validId(route.calculationId)) path = `/calculations/${route.calculationId}`;
      else throw new Error("Editor route requires a calculator or calculation id.");
      break;
    case "results":
      if (!validId(route.calculationId) || !validId(route.runId)) throw new Error("Results route requires UUID ids.");
      path = `/calculations/${route.calculationId}/runs/${route.runId}`; break;
    default: throw new Error("Invalid route.");
  }
  if (route.section !== undefined && !validSection(route.section)) throw new Error("Invalid section.");
  if (route.mode !== undefined && route.mode !== "example" && route.mode !== "blank") throw new Error("Invalid mode.");
  if (route.view !== "editor" && route.view !== "results" && (route.mode !== undefined || route.calculatorId !== undefined || route.calculationId !== undefined || route.runId !== undefined || route.section !== undefined)) throw new Error("Route parameters do not belong to this view.");
  if (route.view === "editor" && route.calculatorId !== undefined && route.calculationId !== undefined) throw new Error("Editor route cannot contain both calculator and calculation ids.");
  if (route.view === "editor" && route.calculationId === undefined && route.mode !== undefined && route.calculatorId === undefined) throw new Error("Mode only applies to a new calculation.");
  if (route.view === "editor" && route.runId !== undefined) throw new Error("Run id only applies to results.");
  if (route.view === "results" && (route.calculatorId !== undefined || route.mode !== undefined)) throw new Error("Results route cannot contain new calculation parameters.");
  const params = new URLSearchParams();
  if (route.view === "editor" && route.calculatorId !== undefined) { params.set("calculator", route.calculatorId); if (route.mode) params.set("mode", route.mode); }
  if (route.section) params.set("section", route.section);
  const suffix = params.toString();
  return `${prefix}${path}${suffix ? `?${suffix}` : ""}`;
}
