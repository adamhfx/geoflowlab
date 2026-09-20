import { Suspense } from "react";
import LoadingSpinner from "../LoadingSpinner";
import { notFound } from "next/navigation";
import App from "../WorkspaceApp";
import { parsePageRoute } from "@/lib/routes";

export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path } = await params;
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) notFound();
    if (value) query.set(key, value);
  }
  const route = parsePageRoute("/" + path.join("/"), query.toString());
  if (!route) notFound();
  return <Suspense fallback={<LoadingSpinner fullPage />}><App preview={route.preview} /></Suspense>;
}

