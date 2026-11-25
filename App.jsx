import { useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function App() {
  const [url, setUrl] = useState('');
  const [data, setData] = useState(null);
  const [cached, setCached] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const generate = async () => {
    setLoading(true); setData(null); setErr(null);
    try {
      const s = await fetch(`${API}/api/scrape`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).then(r => r.json());
      if (s.error) throw new Error(s.error);

      const r = await fetch(`${API}/api/generate-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, text: s.text }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      setCached(r.headers.get('X-Cache') === 'HIT');
      setData(await r.json());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="flex gap-2">
        <input className="flex-1 border p-2 rounded" placeholder="https://example.com"
          value={url} onChange={e => setUrl(e.target.value)} />
        <button className="bg-black text-white px-4 rounded disabled:opacity-50"
          onClick={generate} disabled={loading || !url}>
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {err && <p className="text-red-600 text-sm">{err}</p>}

      {cached !== null && (
        <span className={`text-xs px-2 py-1 rounded ${cached ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
          {cached ? 'Result: Cached' : 'Result: Freshly Generated'}
        </span>
      )}

      {data?.facts && (
        <ul className="list-disc pl-5 space-y-1">
          {data.facts.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}

      {data?.email && (
        <div className="space-y-2">
          <textarea className="w-full border p-2 rounded h-40" readOnly value={data.email} />
          <button className="bg-gray-800 text-white px-3 py-1 rounded text-sm"
            onClick={() => navigator.clipboard.writeText(data.email)}>
            Copy to Clipboard
          </button>
        </div>
      )}
    </div>
  );
}
