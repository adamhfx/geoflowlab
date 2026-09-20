import { Suspense } from "react";
import App from "./WorkspaceApp";
export default function HomePage() { return <Suspense fallback={<p>Opening GeoFlow Lab…</p>}><App /></Suspense>; }
