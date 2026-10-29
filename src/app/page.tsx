const milestones = [
  "Configure provider connections and OAuth credentials",
  "Implement verified, idempotent webhook ingestion",
  "Build configurable field mapping and validation",
  "Add conflict resolution and bidirectional sync workers",
  "Add integration tests and reviewer setup guide",
];

export default function HomePage() {
  return (
    <main>
      <div className="eyebrow">Integration control center</div>
      <h1>Wix ↔ HubSpot Sync</h1>
      <p className="lead">
        A reliability-first foundation for synchronizing contacts in both
        directions, with configurable mappings, event deduplication, and
        traceable conflict resolution.
      </p>

      <section className="cards" aria-label="Provider connection status">
        <article className="card">
          <span className="status"><span className="dot" /> Setup required</span>
          <h2>Wix</h2>
          <p>Connect a Wix app and configure the correct permissions and webhook verification for its app type.</p>
        </article>
        <article className="card">
          <span className="status"><span className="dot" /> Setup required</span>
          <h2>HubSpot</h2>
          <p>Configure a HubSpot developer app and authorize CRM contact read/write access using OAuth.</p>
        </article>
      </section>

      <h2 className="section-title">Implementation roadmap</h2>
      <ol className="checklist">
        {milestones.map((milestone, index) => (
          <li key={milestone}>
            <span className="number">{index + 1}</span>
            <span>{milestone}</span>
          </li>
        ))}
      </ol>

      <footer>
        Initial scaffold only. Provider connections and synchronization are not yet active.
        No tokens or customer data are required to view this page.
      </footer>
    </main>
  );
}
