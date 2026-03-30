import { useState, useCallback } from "react";
import "./App.css";
import {
  SetRepoPath,
  GetBranches,
  GetBranchVersions,
  OpenFolderDialog,
} from "../wailsjs/go/main/App";

interface BranchVersion {
  branch: string;
  version: string;
}

function App() {
  const [repoPath, setRepoPath] = useState("");
  const [versionFile, setVersionFile] = useState("package.json");
  const [branches, setBranches] = useState<string[]>([]);
  const [outputText, setOutputText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [repoSet, setRepoSet] = useState(false);

  const handleBrowse = useCallback(async () => {
    const dir = await OpenFolderDialog();
    if (dir) setRepoPath(dir);
  }, []);

  const handleSetRepo = useCallback(async () => {
    setError("");
    try {
      await SetRepoPath(repoPath);
      setRepoSet(true);
      const list = await GetBranches();
      setBranches(list ?? []);
      setOutputText("");
    } catch (e: any) {
      setError(String(e));
      setRepoSet(false);
    }
  }, [repoPath]);

  const handleGetVersions = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const versions: BranchVersion[] = await GetBranchVersions(versionFile);
      const text = versions
        .map((bv) => `${bv.branch}: ${bv.version}`)
        .join("\n");
      setOutputText(text);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [versionFile]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Prisma Versions</h1>
        <p className="subtitle">Compare versions across git branches</p>
      </header>

      <main>
        <section className="card">
          <h2>Repository</h2>
          <div className="input-row">
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetRepo()}
              placeholder="Path to git repository…"
              className="text-input flex-1"
            />
            <button onClick={handleBrowse} className="btn btn-secondary">
              Browse
            </button>
            <button onClick={handleSetRepo} className="btn btn-primary">
              Set
            </button>
          </div>
          {repoSet && (
            <p className="status-ok">
              ✓ Repository loaded — {branches.length} local branches found
            </p>
          )}
        </section>

        {repoSet && (
          <section className="card">
            <h2>Version File</h2>
            <p className="hint">
              Relative path to the version file inside the repository
            </p>
            <div className="input-row">
              <input
                type="text"
                value={versionFile}
                onChange={(e) => setVersionFile(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGetVersions()}
                placeholder="e.g. package.json, VERSION, pom.xml"
                className="text-input flex-1"
              />
              <button
                onClick={handleGetVersions}
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Loading…" : "Get Versions"}
              </button>
            </div>
          </section>
        )}

        {error && <div className="error-box">{error}</div>}

        {outputText && (
          <section className="card">
            <div className="output-header">
              <h2>Results</h2>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigator.clipboard.writeText(outputText)}
              >
                Copy all
              </button>
            </div>
            <textarea
              className="output-area"
              value={outputText}
              readOnly
              spellCheck={false}
              rows={Math.max(branches.length, 5)}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
