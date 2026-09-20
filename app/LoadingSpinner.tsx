export default function LoadingSpinner({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div className={`loading-state${fullPage ? " loading-state-page" : ""}`} role="status" aria-label="Loading">
      <span className="loading-spinner" aria-hidden="true" />
    </div>
  );
}
