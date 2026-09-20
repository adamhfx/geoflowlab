import { Suspense } from "react";
import LoadingSpinner from "./LoadingSpinner";
import App from "./WorkspaceApp";
export default function HomePage() { return <Suspense fallback={<LoadingSpinner fullPage />}><App /></Suspense>; }

