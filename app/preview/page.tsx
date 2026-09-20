import { Suspense } from "react";
import App from "../WorkspaceApp";
export default function PreviewPage() { return <Suspense fallback={<p>Opening preview…</p>}><App preview /></Suspense>; }
