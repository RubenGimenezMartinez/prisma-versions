import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  CreateUser,
  GetAppState,
  GetBranchesWithMode,
  GetBranchGroupedVersions,
  GetRepoPreferences,
  OpenFolderDialog,
  OpenVersionFileDialog,
  PreviewVersionPattern,
  PreviewVersionPatternInBranch,
  RemoveSavedRepository,
  SaveRepoPreferences,
  SetRepoPath,
  SwitchUser,
} from "../wailsjs/go/main/App";
import { main } from "../wailsjs/go/models";

interface SavedRepository {
  name: string;
  path: string;
}

interface RepoVersionSource {
  id: string;
  name: string;
  filePath: string;
  pattern: string;
  favorite: boolean;
}

interface RepoPreferences {
  branchScope?: string;
  selectedBranches: string[];
  favoriteBranches: string[];
  branchTypes: Record<string, string>;
  versionSources: RepoVersionSource[];
  selectedSourceIds: string[];
}

interface AppState {
  currentUser: string;
  users: string[];
  repoPath: string;
  repositories: SavedRepository[];
}

interface BranchSourceValue {
  sourceId: string;
  name: string;
  value: string;
}

interface BranchGroupedResult {
  branch: string;
  items: BranchSourceValue[];
}

interface PatternPreview {
  status: string;
  extracted: string;
  formatted: string;
  message: string;
}

function App() {
  const [repoPath, setRepoPath] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [favoriteBranches, setFavoriteBranches] = useState<string[]>([]);
  const [branchTypes, setBranchTypes] = useState<Record<string, string>>({});
  const [branchSearch, setBranchSearch] = useState("");
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchScope, setBranchScope] = useState("all");
  const [versionSources, setVersionSources] = useState<RepoVersionSource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [sourceFilePath, setSourceFilePath] = useState("");
  const [sourcePattern, setSourcePattern] = useState("");
  const [sourceFavorite, setSourceFavorite] = useState(false);
  const [disableIncrement, setDisableIncrement] = useState(false);
  const [incrementBy, setIncrementBy] = useState(1);
  const [previewBranch, setPreviewBranch] = useState("current");
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFilePath, setEditFilePath] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editFavorite, setEditFavorite] = useState(false);
  const [patternPreview, setPatternPreview] = useState<PatternPreview | null>(
    null,
  );
  const [outputText, setOutputText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [repoSet, setRepoSet] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState("");
  const [newUser, setNewUser] = useState("");
  const [savedRepos, setSavedRepos] = useState<SavedRepository[]>([]);

  const visibleBranches = useMemo(() => {
    const search = branchSearch.trim().toLowerCase();
    if (!search) {
      return branches;
    }
    return branches.filter((branch) => branch.toLowerCase().includes(search));
  }, [branchSearch, branches]);

  const favoriteSources = useMemo(
    () => versionSources.filter((source) => source.favorite),
    [versionSources],
  );

  const buildPreferencesPayload = useCallback(
    (opts?: {
      branchScope?: string;
      selectedBranches?: string[];
      favoriteBranches?: string[];
      branchTypes?: Record<string, string>;
      versionSources?: RepoVersionSource[];
      selectedSourceIds?: string[];
    }): RepoPreferences => ({
      branchScope: opts?.branchScope ?? branchScope,
      selectedBranches: opts?.selectedBranches ?? selectedBranches,
      favoriteBranches: opts?.favoriteBranches ?? favoriteBranches,
      branchTypes: opts?.branchTypes ?? branchTypes,
      versionSources: opts?.versionSources ?? versionSources,
      selectedSourceIds: opts?.selectedSourceIds ?? selectedSourceIds,
    }),
    [
      selectedBranches,
      favoriteBranches,
      branchTypes,
      branchScope,
      versionSources,
      selectedSourceIds,
    ],
  );

  const persistRepoPreferences = useCallback(
    async (opts?: {
      path?: string;
      branchScope?: string;
      selectedBranches?: string[];
      favoriteBranches?: string[];
      branchTypes?: Record<string, string>;
      versionSources?: RepoVersionSource[];
      selectedSourceIds?: string[];
    }) => {
      const path = opts?.path ?? repoPath;
      if (!currentUser || !path) {
        return;
      }
      const payload = buildPreferencesPayload(opts);
      await SaveRepoPreferences(path, main.RepoPreferences.createFrom(payload));
    },
    [currentUser, repoPath, buildPreferencesPayload],
  );

  const applyRepoPreferences = useCallback(
    async (path: string, branchList: string[]) => {
      if (!path) {
        setSelectedBranches([]);
        setFavoriteBranches([]);
        setBranchTypes({});
        setVersionSources([]);
        setSelectedSourceIds([]);
        return;
      }

      const prefs: RepoPreferences = await GetRepoPreferences(path);
      const availableBranches = new Set(branchList);
      const selected = (prefs.selectedBranches ?? []).filter((b) =>
        availableBranches.has(b),
      );
      const favorites = (prefs.favoriteBranches ?? []).filter((b) =>
        availableBranches.has(b),
      );

      const sources = prefs.versionSources ?? [];
      const validSourceIDs = new Set(sources.map((source) => source.id));
      const selectedIDs = (prefs.selectedSourceIds ?? []).filter((id) =>
        validSourceIDs.has(id),
      );

      const scope =
        prefs.branchScope === "local" ||
        prefs.branchScope === "remote" ||
        prefs.branchScope === "all"
          ? prefs.branchScope
          : "all";
      setBranchScope(scope);

      setSelectedBranches(selected.length > 0 ? selected : [...branchList]);
      setFavoriteBranches(favorites);
      const nextBranchTypes: Record<string, string> = {};
      branchList.forEach((branch) => {
        const value = prefs.branchTypes?.[branch];
        nextBranchTypes[branch] =
          value === "development" || value === "sprint" ? value : "auto";
      });
      setBranchTypes(nextBranchTypes);
      setVersionSources(sources);
      setSelectedSourceIds(
        selectedIDs.length > 0
          ? selectedIDs
          : sources.map((source) => source.id),
      );
    },
    [],
  );

  const loadState = useCallback(async () => {
    const state: AppState = await GetAppState();
    setUsers(state.users ?? []);
    setCurrentUser(state.currentUser ?? "");
    setSavedRepos(state.repositories ?? []);
    setRepoPath(state.repoPath ?? "");
    if (state.repoPath) {
      setRepoSet(true);
      const list = await GetBranchesWithMode(branchScope);
      setBranches(list ?? []);
      await applyRepoPreferences(state.repoPath, list ?? []);
    } else {
      setRepoSet(false);
      setBranches([]);
      setSelectedBranches([]);
      setFavoriteBranches([]);
      setBranchTypes({});
      setVersionSources([]);
      setSelectedSourceIds([]);
    }
  }, [applyRepoPreferences, branchScope]);

  useEffect(() => {
    loadState().catch((e: unknown) => setError(String(e)));
  }, [loadState]);

  const handleBrowse = useCallback(async () => {
    const dir = await OpenFolderDialog();
    if (dir) {
      setRepoPath(dir);
    }
  }, []);

  const handleBrowseVersionFile = useCallback(async () => {
    const file = await OpenVersionFileDialog();
    if (file) {
      setSourceFilePath(file);
    }
  }, []);

  const handleBrowseEditVersionFile = useCallback(async () => {
    const file = await OpenVersionFileDialog();
    if (file) {
      setEditFilePath(file);
    }
  }, []);

  const handleCreateUser = useCallback(async () => {
    setError("");
    try {
      await CreateUser(newUser);
      setNewUser("");
      await loadState();
      setOutputText("");
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [newUser, loadState]);

  const handleSwitchUser = useCallback(
    async (user: string) => {
      setError("");
      try {
        await SwitchUser(user);
        await loadState();
        setOutputText("");
        setBranchSearch("");
        setBranchDropdownOpen(false);
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [loadState],
  );

  const handleSetRepo = useCallback(async () => {
    setError("");
    try {
      await SetRepoPath(repoPath);
      setRepoSet(true);
      const list = await GetBranchesWithMode(branchScope);
      setBranches(list ?? []);
      await applyRepoPreferences(repoPath, list ?? []);
      setOutputText("");
      const state: AppState = await GetAppState();
      setSavedRepos(state.repositories ?? []);
    } catch (e: unknown) {
      setError(String(e));
      setRepoSet(false);
    }
  }, [repoPath, applyRepoPreferences]);

  const handlePickSavedRepo = useCallback(
    async (path: string) => {
      setRepoPath(path);
      setError("");
      try {
        await SetRepoPath(path);
        setRepoSet(true);
        const list = await GetBranchesWithMode(branchScope);
        setBranches(list ?? []);
        await applyRepoPreferences(path, list ?? []);
        setOutputText("");
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [applyRepoPreferences, branchScope],
  );

  const handleRemoveSavedRepo = useCallback(async (path: string) => {
    setError("");
    try {
      await RemoveSavedRepository(path);
      const state: AppState = await GetAppState();
      setSavedRepos(state.repositories ?? []);
      if (!state.repoPath) {
        setRepoPath("");
        setRepoSet(false);
        setBranches([]);
        setSelectedBranches([]);
        setFavoriteBranches([]);
        setBranchTypes({});
        setVersionSources([]);
        setSelectedSourceIds([]);
        setOutputText("");
      }
    } catch (e: unknown) {
      setError(String(e));
    }
  }, []);

  const toggleBranchSelection = useCallback(
    async (branch: string) => {
      const next = selectedBranches.includes(branch)
        ? selectedBranches.filter((b) => b !== branch)
        : [...selectedBranches, branch];
      setSelectedBranches(next);
      await persistRepoPreferences({ selectedBranches: next });
    },
    [selectedBranches, persistRepoPreferences],
  );

  const toggleFavoriteBranch = useCallback(
    async (branch: string) => {
      const next = favoriteBranches.includes(branch)
        ? favoriteBranches.filter((b) => b !== branch)
        : [...favoriteBranches, branch];
      setFavoriteBranches(next);
      await persistRepoPreferences({ favoriteBranches: next });
    },
    [favoriteBranches, persistRepoPreferences],
  );

  const handleSelectAllBranches = useCallback(async () => {
    const next = [...branches];
    setSelectedBranches(next);
    await persistRepoPreferences({ selectedBranches: next });
  }, [branches, persistRepoPreferences]);

  const handleClearBranchSelection = useCallback(async () => {
    setSelectedBranches([]);
    await persistRepoPreferences({ selectedBranches: [] });
  }, [persistRepoPreferences]);

  const handleBranchTypeChange = useCallback(
    async (branch: string, branchType: string) => {
      const normalized =
        branchType === "development" || branchType === "sprint"
          ? branchType
          : "auto";
      const next = { ...branchTypes, [branch]: normalized };
      setBranchTypes(next);
      await persistRepoPreferences({ branchTypes: next });
    },
    [branchTypes, persistRepoPreferences],
  );

  const addVersionSource = useCallback(async () => {
    setError("");
    const name = sourceName.trim();
    const filePath = sourceFilePath.trim();
    if (!name || !filePath) {
      setError("Name and file path are required for a source");
      return;
    }

    const id = `src-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const source: RepoVersionSource = {
      id,
      name,
      filePath,
      pattern: sourcePattern.trim(),
      favorite: sourceFavorite,
    };

    const nextSources = [...versionSources, source];
    const nextSelected = [...selectedSourceIds, source.id];
    setVersionSources(nextSources);
    setSelectedSourceIds(nextSelected);
    setSourceName("");
    setSourceFilePath("");
    setSourcePattern("");
    setSourceFavorite(false);
    setPatternPreview(null);
    await persistRepoPreferences({
      versionSources: nextSources,
      selectedSourceIds: nextSelected,
    });
  }, [
    sourceName,
    sourceFilePath,
    sourcePattern,
    sourceFavorite,
    versionSources,
    selectedSourceIds,
    persistRepoPreferences,
  ]);

  const removeVersionSource = useCallback(
    async (id: string) => {
      const nextSources = versionSources.filter((source) => source.id !== id);
      const nextSelected = selectedSourceIds.filter(
        (sourceID) => sourceID !== id,
      );
      setVersionSources(nextSources);
      setSelectedSourceIds(nextSelected);
      await persistRepoPreferences({
        versionSources: nextSources,
        selectedSourceIds: nextSelected,
      });
    },
    [versionSources, selectedSourceIds, persistRepoPreferences],
  );

  const handleUseFavoriteSources = useCallback(async () => {
    const ids = favoriteSources.map((source) => source.id);
    setSelectedSourceIds(ids);
    await persistRepoPreferences({ selectedSourceIds: ids });
  }, [favoriteSources, persistRepoPreferences]);

  const beginEditSource = useCallback((source: RepoVersionSource) => {
    setEditingSourceId(source.id);
    setEditName(source.name);
    setEditFilePath(source.filePath);
    setEditPattern(source.pattern);
    setEditFavorite(source.favorite);
  }, []);

  const cancelEditSource = useCallback(() => {
    setEditingSourceId(null);
    setEditName("");
    setEditFilePath("");
    setEditPattern("");
    setEditFavorite(false);
  }, []);

  const saveEditSource = useCallback(async () => {
    if (!editingSourceId) {
      return;
    }
    const name = editName.trim();
    const filePath = editFilePath.trim();
    if (!name || !filePath) {
      setError("Name and file path are required for a source");
      return;
    }
    const nextSources = versionSources.map((source) =>
      source.id === editingSourceId
        ? {
            ...source,
            name,
            filePath,
            pattern: editPattern.trim(),
            favorite: editFavorite,
          }
        : source,
    );
    setVersionSources(nextSources);
    await persistRepoPreferences({ versionSources: nextSources });
    cancelEditSource();
  }, [
    editingSourceId,
    editName,
    editFilePath,
    editPattern,
    editFavorite,
    versionSources,
    persistRepoPreferences,
    cancelEditSource,
  ]);

  const toggleSourceSelection = useCallback(
    async (id: string) => {
      const nextSelected = selectedSourceIds.includes(id)
        ? selectedSourceIds.filter((sourceID) => sourceID !== id)
        : [...selectedSourceIds, id];
      setSelectedSourceIds(nextSelected);
      await persistRepoPreferences({ selectedSourceIds: nextSelected });
    },
    [selectedSourceIds, persistRepoPreferences],
  );

  const toggleSourceFavorite = useCallback(
    async (id: string) => {
      const nextSources = versionSources.map((source) =>
        source.id === id ? { ...source, favorite: !source.favorite } : source,
      );
      setVersionSources(nextSources);
      await persistRepoPreferences({ versionSources: nextSources });
    },
    [versionSources, persistRepoPreferences],
  );

  const handleGetVersions = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const selectedSources = versionSources.filter((source) =>
        selectedSourceIds.includes(source.id),
      );
      if (selectedSources.length === 0) {
        setError("Select at least one version source");
        return;
      }

      const grouped: BranchGroupedResult[] = await GetBranchGroupedVersions(
        selectedSources,
        selectedBranches,
        branchTypes,
        incrementBy,
        !disableIncrement,
      );

      const sourceMap = new Map(
        selectedSources.map((source) => [source.id, source]),
      );

      const text = grouped
        .map((branchGroup) => {
          const lines = [
            `Branch: ${branchGroup.branch}`,
            "----------------------------------------",
          ];

          for (const item of branchGroup.items) {
            const source = sourceMap.get(item.sourceId);
            const sourceTitle = source
              ? `${item.name} (${source.filePath})`
              : item.name;
            lines.push(`Source: ${sourceTitle}`);

            const valueLines = (item.value || "no-version")
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);

            if (valueLines.length === 0) {
              lines.push("  - no-version");
            } else {
              for (const valueLine of valueLines) {
                lines.push(`  - ${valueLine}`);
              }
            }
            lines.push("");
          }

          if (lines[lines.length - 1] === "") {
            lines.pop();
          }
          return lines.join("\n");
        })
        .join("\n\n");

      setOutputText(text);
      await persistRepoPreferences();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    branchTypes,
    disableIncrement,
    incrementBy,
    selectedBranches,
    selectedSourceIds,
    versionSources,
    persistRepoPreferences,
  ]);

  useEffect(() => {
    if (!repoSet || !sourceFilePath.trim()) {
      setPatternPreview(null);
      return;
    }

    const timer = window.setTimeout(() => {
      PreviewVersionPatternInBranch(
        sourceFilePath.trim(),
        sourcePattern.trim(),
        previewBranch === "current"
          ? "auto"
          : (branchTypes[previewBranch] ?? "auto"),
        previewBranch,
      )
        .then((preview: PatternPreview) => setPatternPreview(preview))
        .catch((err: unknown) => {
          setPatternPreview({
            status: "error",
            extracted: "",
            formatted: "",
            message: String(err),
          });
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [repoSet, sourceFilePath, sourcePattern, previewBranch, branchTypes]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Prisma Versions</h1>
        <p className="subtitle">Compare versions across git branches</p>
      </header>

      <main>
        <section className="card">
          <h2>User</h2>
          <div className="user-row">
            <select
              className="text-input"
              value={currentUser}
              onChange={(e) => handleSwitchUser(e.target.value)}
            >
              <option value="">Select user...</option>
              {users.map((user) => (
                <option key={user} value={user}>
                  {user}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
              placeholder="New user (e.g. ruben)"
              className="text-input flex-1"
            />
            <button onClick={handleCreateUser} className="btn btn-secondary">
              Create User
            </button>
          </div>
          {!currentUser && (
            <p className="hint">
              First launch: create a user to store your repositories.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Repository</h2>
          <div className="input-row">
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetRepo()}
              placeholder="Path to git repository..."
              className="text-input flex-1"
              disabled={!currentUser}
            />
            <button
              onClick={handleBrowse}
              className="btn btn-secondary"
              disabled={!currentUser}
            >
              Browse
            </button>
            <button
              onClick={handleSetRepo}
              className="btn btn-primary"
              disabled={!currentUser}
            >
              Set
            </button>
          </div>
          {savedRepos.length > 0 && (
            <div className="saved-repos">
              {savedRepos.map((repo) => (
                <div key={repo.path} className="saved-repo-item">
                  <button
                    title={repo.path}
                    className="saved-repo"
                    onClick={() => handlePickSavedRepo(repo.path)}
                  >
                    {repo.name}
                  </button>
                  <button
                    className="saved-repo-remove"
                    title={`Remove ${repo.path}`}
                    onClick={() => handleRemoveSavedRepo(repo.path)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          {repoSet && (
            <p className="status-ok">
              ✓ Repository loaded - {branches.length} local branches found
            </p>
          )}
        </section>

        {repoSet && (
          <section className="card">
            <h2>Branches</h2>
            <p className="hint">
              Choose which branches to include and mark favorites.
            </p>

            <div className="input-row">
              <select
                className="text-input"
                value={branchScope}
                onChange={(e) => {
                  const scope = e.target.value;
                  setBranchScope(scope);
                  persistRepoPreferences({ branchScope: scope }).catch(
                    (err: unknown) => setError(String(err)),
                  );
                }}
              >
                <option value="all">Local + Remote</option>
                <option value="local">Only Local</option>
                <option value="remote">Only Remote</option>
              </select>
            </div>

            {favoriteBranches.length > 0 && (
              <div className="favorite-branches">
                {favoriteBranches.map((branch) => (
                  <button
                    key={branch}
                    className={`favorite-branch ${selectedBranches.includes(branch) ? "selected" : ""}`}
                    onClick={() => {
                      toggleBranchSelection(branch).catch((e: unknown) =>
                        setError(String(e)),
                      );
                    }}
                    title={branch}
                  >
                    {branch}
                  </button>
                ))}
              </div>
            )}

            <div className="branch-dropdown">
              <button
                className="btn btn-secondary branch-dropdown-toggle"
                onClick={() => setBranchDropdownOpen((value) => !value)}
              >
                Select branches ({selectedBranches.length}/{branches.length})
              </button>

              {branchDropdownOpen && (
                <div className="branch-dropdown-menu">
                  <input
                    type="text"
                    className="text-input"
                    placeholder="Search branch..."
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                  />
                  <div className="branch-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleSelectAllBranches}
                    >
                      All
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleClearBranchSelection}
                    >
                      None
                    </button>
                  </div>
                  <div className="branch-list">
                    {visibleBranches.map((branch) => (
                      <div key={branch} className="branch-row">
                        <label className="branch-check">
                          <input
                            type="checkbox"
                            checked={selectedBranches.includes(branch)}
                            onChange={() => {
                              toggleBranchSelection(branch).catch(
                                (e: unknown) => setError(String(e)),
                              );
                            }}
                          />
                          <span>{branch}</span>
                        </label>
                        <div className="branch-row-actions">
                          <select
                            className="branch-type-select"
                            value={branchTypes[branch] ?? "auto"}
                            onChange={(e) => {
                              handleBranchTypeChange(
                                branch,
                                e.target.value,
                              ).catch((err: unknown) => setError(String(err)));
                            }}
                            title="Branch type"
                          >
                            <option value="auto">Auto</option>
                            <option value="development">Dev</option>
                            <option value="sprint">Sprint</option>
                          </select>
                          <button
                            className={`favorite-toggle ${favoriteBranches.includes(branch) ? "on" : ""}`}
                            title={
                              favoriteBranches.includes(branch)
                                ? "Remove favorite"
                                : "Add favorite"
                            }
                            onClick={() => {
                              toggleFavoriteBranch(branch).catch((e: unknown) =>
                                setError(String(e)),
                              );
                            }}
                          >
                            {favoriteBranches.includes(branch) ? "*" : "o"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {repoSet && (
          <section className="card">
            <h2>Version Sources</h2>
            <p className="hint">
              Configure file + optional regex pattern. Example:
              (\d+\.\d+\.\d+\.\d+(?:\.\d+)?). Without pattern, first line is
              used.
            </p>

            <div className="version-source-form">
              <input
                className="text-input"
                placeholder="Display name (e.g. Frontend)"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
              />
              <input
                className="text-input"
                placeholder="File path (e.g. package.json, VERSION.txt)"
                value={sourceFilePath}
                onChange={(e) => setSourceFilePath(e.target.value)}
              />
              <button
                className="btn btn-secondary"
                onClick={() => {
                  handleBrowseVersionFile().catch((e: unknown) =>
                    setError(String(e)),
                  );
                }}
              >
                Browse file
              </button>
              <input
                className="text-input"
                placeholder="Regex pattern optional (group 1 preferred)"
                value={sourcePattern}
                onChange={(e) => setSourcePattern(e.target.value)}
              />
              <select
                className="text-input"
                value={previewBranch}
                onChange={(e) => setPreviewBranch(e.target.value)}
              >
                <option value="current">Preview branch: current</option>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    Preview branch: {branch}
                  </option>
                ))}
              </select>
              <label className="source-favorite-check">
                <input
                  type="checkbox"
                  checked={sourceFavorite}
                  onChange={(e) => setSourceFavorite(e.target.checked)}
                />
                Favorite
              </label>
              <button
                className="btn btn-primary"
                onClick={() =>
                  addVersionSource().catch((e: unknown) => setError(String(e)))
                }
              >
                Add source
              </button>
            </div>

            {patternPreview && (
              <div
                className={`pattern-preview pattern-${patternPreview.status}`}
              >
                <strong>{patternPreview.status}</strong>
                <span>{patternPreview.message}</span>
                {patternPreview.extracted && (
                  <span>Extracted: {patternPreview.extracted}</span>
                )}
                {patternPreview.formatted && (
                  <span>Next: {patternPreview.formatted}</span>
                )}
              </div>
            )}

            {favoriteSources.length > 0 && (
              <div className="favorite-sources">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    handleUseFavoriteSources().catch((e: unknown) =>
                      setError(String(e)),
                    );
                  }}
                >
                  Use only favorites
                </button>
                {favoriteSources.map((source) => (
                  <button
                    key={source.id}
                    className={`favorite-source ${selectedSourceIds.includes(source.id) ? "selected" : ""}`}
                    onClick={() => {
                      toggleSourceSelection(source.id).catch((e: unknown) =>
                        setError(String(e)),
                      );
                    }}
                    title={`${source.name} - ${source.filePath}`}
                  >
                    {source.name}
                  </button>
                ))}
              </div>
            )}

            <div className="source-list">
              {versionSources.map((source) => (
                <div key={source.id} className="source-row">
                  {editingSourceId === source.id ? (
                    <div className="source-edit-grid">
                      <input
                        className="text-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Name"
                      />
                      <div className="source-edit-path">
                        <input
                          className="text-input"
                          value={editFilePath}
                          onChange={(e) => setEditFilePath(e.target.value)}
                          placeholder="File path"
                        />
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            handleBrowseEditVersionFile().catch((e: unknown) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          Browse
                        </button>
                      </div>
                      <input
                        className="text-input"
                        value={editPattern}
                        onChange={(e) => setEditPattern(e.target.value)}
                        placeholder="Regex pattern (optional)"
                      />
                      <label className="source-favorite-check">
                        <input
                          type="checkbox"
                          checked={editFavorite}
                          onChange={(e) => setEditFavorite(e.target.checked)}
                        />
                        Favorite
                      </label>
                      <div className="source-edit-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            saveEditSource().catch((e: unknown) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          Save
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={cancelEditSource}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="source-select">
                        <input
                          type="checkbox"
                          checked={selectedSourceIds.includes(source.id)}
                          onChange={() => {
                            toggleSourceSelection(source.id).catch(
                              (e: unknown) => setError(String(e)),
                            );
                          }}
                        />
                        <span className="source-main">
                          <span className="source-name">{source.name}</span>
                          <span className="source-file" title={source.filePath}>
                            {source.filePath}
                          </span>
                          {source.pattern && (
                            <span
                              className="source-pattern"
                              title={source.pattern}
                            >
                              Pattern: {source.pattern}
                            </span>
                          )}
                        </span>
                      </label>
                      <div className="source-actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => beginEditSource(source)}
                          title={`Edit ${source.name}`}
                        >
                          Edit
                        </button>
                        <button
                          className={`favorite-toggle ${source.favorite ? "on" : ""}`}
                          title={
                            source.favorite ? "Remove favorite" : "Add favorite"
                          }
                          onClick={() => {
                            toggleSourceFavorite(source.id).catch(
                              (e: unknown) => setError(String(e)),
                            );
                          }}
                        >
                          {source.favorite ? "*" : "o"}
                        </button>
                        <button
                          className="saved-repo-remove"
                          title={`Remove ${source.name}`}
                          onClick={() => {
                            removeVersionSource(source.id).catch((e: unknown) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          x
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {repoSet && (
          <section className="card">
            <div className="input-row">
              <label className="source-favorite-check">
                <input
                  type="checkbox"
                  checked={disableIncrement}
                  onChange={(e) => setDisableIncrement(e.target.checked)}
                />
                No incrementar version
              </label>
              <input
                type="number"
                className="text-input"
                min={1}
                step={1}
                disabled={disableIncrement}
                value={incrementBy}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(value) || value < 1) {
                    setIncrementBy(1);
                    return;
                  }
                  setIncrementBy(value);
                }}
                title="Increment step"
              />
              <button
                onClick={handleGetVersions}
                className="btn btn-primary"
                disabled={loading || !currentUser}
              >
                {loading ? "Loading..." : "Get Versions"}
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
              rows={Math.max(branches.length * 2, 8)}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
