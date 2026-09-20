import { Suspense } from "react";
import LoadingSpinner from "../LoadingSpinner";
import App from "../WorkspaceApp";
export default function PreviewPage() { return <Suspense fallback={<LoadingSpinner fullPage />}><App preview /></Suspense>; }

