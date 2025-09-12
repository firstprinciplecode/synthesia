export type AgentRow = {
  id: string;
  name: string;
  description?: string | null;
  defaultModel?: string;
  defaultProvider?: string;
  avatarUrl?: string;
};

export function DataTableAgents({ rows }: { rows: AgentRow[] }) {
  return (
    <div className="overflow-auto border rounded-md">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-2">Avatar</th>
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Model</th>
            <th className="text-left p-2">Provider</th>
            <th className="text-right p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">
                {r.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.avatarUrl} alt={r.name} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted" />
                )}
              </td>
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.defaultModel || '-'}</td>
              <td className="p-2">{r.defaultProvider || '-'}</td>
              <td className="p-2 text-right">
                <a
                  href={`/agents/${encodeURIComponent(r.id)}`}
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-accent"
                >
                  Edit
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


