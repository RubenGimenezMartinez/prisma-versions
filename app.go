package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// gitCommand creates a git command and applies platform-specific process options.
func gitCommand(args ...string) *exec.Cmd {
	cmd := exec.Command("git", args...)
	hideProcessWindow(cmd)
	return cmd
}

// App struct
type App struct {
	ctx      context.Context
	repoPath string
	user     string
}

// BranchVersion holds a branch name and its detected version.
type BranchVersion struct {
	Branch  string `json:"branch"`
	Version string `json:"version"`
}

// SavedRepository is a remembered git repository for a user.
type SavedRepository struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// RepoVersionSource represents one configurable version target file.
type RepoVersionSource struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	FilePath string `json:"filePath"`
	Pattern  string `json:"pattern"`
	Favorite bool   `json:"favorite"`
}

// RepoPreferences stores branch selection/favorites for one repository.
type RepoPreferences struct {
	VersionFile       string              `json:"versionFile,omitempty"`
	BranchScope       string              `json:"branchScope,omitempty"`
	SelectedBranches  []string            `json:"selectedBranches"`
	FavoriteBranches  []string            `json:"favoriteBranches"`
	BranchTypes       map[string]string   `json:"branchTypes"`
	VersionSources    []RepoVersionSource `json:"versionSources"`
	SelectedSourceIDs []string            `json:"selectedSourceIds"`
}

// UserSettings is persisted to config/<user>/settings.json.
type UserSettings struct {
	Repositories    []string                   `json:"repositories"`
	LastRepo        string                     `json:"lastRepo"`
	RepoPreferences map[string]RepoPreferences `json:"repoPreferences"`
}

// AppState is returned at startup so frontend can bootstrap user/session state.
type AppState struct {
	CurrentUser  string            `json:"currentUser"`
	Users        []string          `json:"users"`
	RepoPath     string            `json:"repoPath"`
	Repositories []SavedRepository `json:"repositories"`
}

// BranchSourceValue contains one extracted value for a source in a branch.
type BranchSourceValue struct {
	SourceID string `json:"sourceId"`
	Name     string `json:"name"`
	Value    string `json:"value"`
}

// BranchGroupedResult groups all extracted values for a branch.
type BranchGroupedResult struct {
	Branch string              `json:"branch"`
	Items  []BranchSourceValue `json:"items"`
}

// PatternPreview represents validation/extraction preview for a source pattern.
type PatternPreview struct {
	Status    string `json:"status"`
	Extracted string `json:"extracted"`
	Formatted string `json:"formatted"`
	Message   string `json:"message"`
}

type versionCandidate struct {
	Label    string
	Original string
	Token    string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	_ = a.restoreSession()
}

// OpenFolderDialog opens a native OS directory picker and returns the chosen path.
func (a *App) OpenFolderDialog() string {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Git Repository",
	})
	if err != nil {
		return ""
	}
	return dir
}

// OpenVersionFileDialog opens a file picker rooted at the current repository.
// Returns a repository-relative file path when possible.
func (a *App) OpenVersionFileDialog() string {
	if strings.TrimSpace(a.repoPath) == "" {
		return ""
	}
	file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select Version File",
		DefaultDirectory: a.repoPath,
	})
	if err != nil || file == "" {
		return ""
	}
	rel, relErr := filepath.Rel(a.repoPath, file)
	if relErr == nil && rel != "" && !strings.HasPrefix(rel, "..") {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(file)
}

// GetAppState returns the user/session state loaded from local config files.
func (a *App) GetAppState() (AppState, error) {
	users, err := listUsers()
	if err != nil {
		return AppState{}, err
	}
	state := AppState{
		CurrentUser: a.user,
		Users:       users,
		RepoPath:    a.repoPath,
	}
	if a.user != "" {
		repos, err := a.GetSavedRepositories()
		if err != nil {
			return AppState{}, err
		}
		state.Repositories = repos
	}
	return state, nil
}

// CreateUser creates a config folder for a new user and sets it as active.
func (a *App) CreateUser(username string) error {
	username, err := validateUsername(username)
	if err != nil {
		return err
	}
	if err := ensureUserConfig(username); err != nil {
		return err
	}
	a.user = username
	a.repoPath = ""
	if err := saveCurrentUser(username); err != nil {
		return err
	}
	return nil
}

// SwitchUser activates an existing user profile.
func (a *App) SwitchUser(username string) error {
	username, err := validateUsername(username)
	if err != nil {
		return err
	}
	if !userExists(username) {
		return fmt.Errorf("user does not exist: %s", username)
	}
	a.user = username
	if err := saveCurrentUser(username); err != nil {
		return err
	}
	settings, err := loadUserSettings(username)
	if err != nil {
		return err
	}
	a.repoPath = settings.LastRepo
	return nil
}

// GetSavedRepositories returns remembered repositories for the active user.
func (a *App) GetSavedRepositories() ([]SavedRepository, error) {
	if a.user == "" {
		return []SavedRepository{}, nil
	}
	settings, err := loadUserSettings(a.user)
	if err != nil {
		return nil, err
	}
	result := make([]SavedRepository, 0, len(settings.Repositories))
	for _, repo := range settings.Repositories {
		repo = filepath.Clean(strings.TrimSpace(repo))
		if repo == "" {
			continue
		}
		result = append(result, SavedRepository{
			Name: filepath.Base(repo),
			Path: repo,
		})
	}
	return result, nil
}

// RemoveSavedRepository deletes a repository from the active user profile.
func (a *App) RemoveSavedRepository(path string) error {
	if a.user == "" {
		return errors.New("select or create a user first")
	}
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return errors.New("repository path is required")
	}
	settings, err := loadUserSettings(a.user)
	if err != nil {
		return err
	}
	filtered := make([]string, 0, len(settings.Repositories))
	for _, repo := range settings.Repositories {
		if !strings.EqualFold(filepath.Clean(repo), path) {
			filtered = append(filtered, repo)
		}
	}
	settings.Repositories = filtered
	delete(settings.RepoPreferences, path)
	if strings.EqualFold(filepath.Clean(settings.LastRepo), path) {
		settings.LastRepo = ""
		a.repoPath = ""
	}
	return saveUserSettings(a.user, settings)
}

// GetRepoPreferences returns saved preferences for a repository.
func (a *App) GetRepoPreferences(repoPath string) (RepoPreferences, error) {
	if a.user == "" {
		return RepoPreferences{}, errors.New("select or create a user first")
	}
	if strings.TrimSpace(repoPath) == "" {
		repoPath = a.repoPath
	}
	repoPath = filepath.Clean(repoPath)
	settings, err := loadUserSettings(a.user)
	if err != nil {
		return RepoPreferences{}, err
	}
	prefs, ok := settings.RepoPreferences[repoPath]
	if !ok {
		return normalizeRepoPreferences(RepoPreferences{}), nil
	}
	return normalizeRepoPreferences(prefs), nil
}

// SaveRepoPreferences persists branch and version source preferences.
func (a *App) SaveRepoPreferences(repoPath string, prefs RepoPreferences) error {
	if a.user == "" {
		return errors.New("select or create a user first")
	}
	if strings.TrimSpace(repoPath) == "" {
		repoPath = a.repoPath
	}
	repoPath = filepath.Clean(repoPath)
	if repoPath == "" {
		return errors.New("repository path is required")
	}
	settings, err := loadUserSettings(a.user)
	if err != nil {
		return err
	}
	if settings.RepoPreferences == nil {
		settings.RepoPreferences = map[string]RepoPreferences{}
	}
	prefs = normalizeRepoPreferences(prefs)
	settings.RepoPreferences[repoPath] = prefs
	return saveUserSettings(a.user, settings)
}

// SetRepoPath validates that path is a git repository and stores it.
func (a *App) SetRepoPath(path string) error {
	if a.user == "" {
		return errors.New("select or create a user first")
	}
	path = filepath.Clean(path)
	cmd := gitCommand("-C", path, "rev-parse", "--git-dir")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("not a valid git repository: %s", path)
	}
	a.repoPath = path

	settings, err := loadUserSettings(a.user)
	if err != nil {
		return err
	}
	if !containsPath(settings.Repositories, path) {
		settings.Repositories = append(settings.Repositories, path)
	}
	if settings.RepoPreferences == nil {
		settings.RepoPreferences = map[string]RepoPreferences{}
	}
	if _, ok := settings.RepoPreferences[path]; !ok {
		settings.RepoPreferences[path] = normalizeRepoPreferences(RepoPreferences{})
	}
	settings.LastRepo = path
	if err := saveUserSettings(a.user, settings); err != nil {
		return err
	}
	return nil
}

// GetRepoPath returns the currently configured repository path.
func (a *App) GetRepoPath() string {
	return a.repoPath
}

// GetBranches returns the list of local branch names for the configured repository.
func (a *App) GetBranches() ([]string, error) {
	return a.getBranchesByMode("all")
}

// GetBranchesWithMode returns branches according to scope: local, all, or remote.
func (a *App) GetBranchesWithMode(mode string) ([]string, error) {
	return a.getBranchesByMode(mode)
}

func (a *App) getBranchesByMode(mode string) ([]string, error) {
	if a.repoPath == "" {
		return nil, fmt.Errorf("no repository configured")
	}
	mode = strings.ToLower(strings.TrimSpace(mode))
	includeLocal := mode == "" || mode == "all" || mode == "local"
	includeRemote := mode == "" || mode == "all" || mode == "remote"
	if !includeLocal && !includeRemote {
		includeLocal = true
		includeRemote = true
	}

	// Best effort refresh of remote-tracking refs; failures are ignored to support offline usage.
	if includeRemote {
		_ = gitCommand("-C", a.repoPath, "fetch", "--all", "--prune").Run()
	}

	branches := make([]string, 0)
	seen := map[string]struct{}{}
	addBranch := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		branches = append(branches, name)
	}

	if includeLocal {
		localCmd := gitCommand("-C", a.repoPath, "branch", "--format=%(refname:short)")
		localOut, err := localCmd.Output()
		if err != nil {
			return nil, fmt.Errorf("failed to list local branches: %w", err)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(localOut)), "\n") {
			branch := strings.TrimSpace(line)
			addBranch(branch)
		}
	}

	if includeRemote {
		remoteCmd := gitCommand("-C", a.repoPath, "branch", "-r", "--format=%(refname:short)")
		remoteOut, err := remoteCmd.Output()
		if err == nil {
			for _, line := range strings.Split(strings.TrimSpace(string(remoteOut)), "\n") {
				remoteRef := strings.TrimSpace(line)
				if remoteRef == "" || strings.HasSuffix(remoteRef, "/HEAD") {
					continue
				}
				addBranch(remoteRef)
			}
		}

		// Query remotes directly too, in case tracking refs are stale/missing locally.
		remotesCmd := gitCommand("-C", a.repoPath, "remote")
		remotesOut, err := remotesCmd.Output()
		if err == nil {
			for _, line := range strings.Split(strings.TrimSpace(string(remotesOut)), "\n") {
				remoteName := strings.TrimSpace(line)
				if remoteName == "" {
					continue
				}
				lsCmd := gitCommand("-C", a.repoPath, "ls-remote", "--heads", remoteName)
				lsOut, lsErr := lsCmd.Output()
				if lsErr != nil {
					continue
				}
				for _, headLine := range strings.Split(strings.TrimSpace(string(lsOut)), "\n") {
					headLine = strings.TrimSpace(headLine)
					if headLine == "" {
						continue
					}
					parts := strings.Fields(headLine)
					if len(parts) < 2 {
						continue
					}
					ref := parts[1]
					const prefix = "refs/heads/"
					if !strings.HasPrefix(ref, prefix) {
						continue
					}
					branchName := strings.TrimPrefix(ref, prefix)
					addBranch(remoteName + "/" + branchName)
				}
			}
		}
	}

	sort.Strings(branches)
	return branches, nil
}

// GetBranchVersions reads versionFile from every local branch and returns
// a slice of BranchVersion with the extracted version string (or "N/A").
func (a *App) GetBranchVersions(versionFile string, selectedBranches []string) ([]BranchVersion, error) {
	if a.repoPath == "" {
		return nil, fmt.Errorf("no repository configured")
	}
	if versionFile == "" {
		versionFile = "package.json"
	}
	source := RepoVersionSource{
		ID:       "legacy",
		Name:     filepath.Base(versionFile),
		FilePath: versionFile,
	}
	grouped, err := a.GetBranchGroupedVersions([]RepoVersionSource{source}, selectedBranches, nil, 1, true)
	if err != nil {
		return nil, err
	}
	var results []BranchVersion
	for _, row := range grouped {
		version := "N/A"
		if len(row.Items) > 0 {
			version = row.Items[0].Value
		}
		results = append(results, BranchVersion{Branch: row.Branch, Version: version})
	}
	return results, nil
}

// GetBranchGroupedVersions returns extracted values grouped by branch.
func (a *App) GetBranchGroupedVersions(sources []RepoVersionSource, selectedBranches []string, branchTypes map[string]string, incrementStep int, applyIncrement bool) ([]BranchGroupedResult, error) {
	if a.repoPath == "" {
		return nil, fmt.Errorf("no repository configured")
	}
	branches := uniqueStrings(selectedBranches)
	if len(branches) == 0 {
		var err error
		branches, err = a.GetBranches()
		if err != nil {
			return nil, err
		}
	}
	sources = uniqueSources(sources)
	if len(sources) == 0 {
		return nil, errors.New("no version sources selected")
	}

	results := make([]BranchGroupedResult, 0, len(branches))
	for _, branch := range branches {
		row := BranchGroupedResult{Branch: branch, Items: []BranchSourceValue{}}
		_ = branchTypes
		for _, source := range sources {
			value := "no-version"
			if strings.TrimSpace(source.FilePath) != "" {
				content, err := a.readFileFromBranch(branch, source.FilePath)
				if err == nil {
					candidates := detectVersionCandidates(content, source.Pattern)
					if len(candidates) > 0 {
						lines := make([]string, 0, len(candidates))
						for _, candidate := range candidates {
							formatted := formatCandidate(candidate, incrementStep, applyIncrement)
							if formatted != "" {
								lines = append(lines, formatted)
							}
						}
						if len(lines) > 0 {
							value = strings.Join(lines, "\n")
						}
					}
				}
			}
			name := strings.TrimSpace(source.Name)
			if name == "" {
				name = filepath.Base(source.FilePath)
			}
			row.Items = append(row.Items, BranchSourceValue{
				SourceID: source.ID,
				Name:     name,
				Value:    value,
			})
		}
		results = append(results, row)
	}
	return results, nil
}

// PreviewVersionPattern validates the configured file/pattern and previews extraction.
func (a *App) PreviewVersionPattern(filePath string, pattern string, branchType string) (PatternPreview, error) {
	return a.PreviewVersionPatternInBranch(filePath, pattern, branchType, "")
}

// PreviewVersionPatternInBranch validates pattern extraction in a chosen branch.
func (a *App) PreviewVersionPatternInBranch(filePath string, pattern string, branchType string, branch string) (PatternPreview, error) {
	if strings.TrimSpace(a.repoPath) == "" {
		return PatternPreview{}, fmt.Errorf("no repository configured")
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return PatternPreview{Status: "missing-file", Message: "Select a file first"}, nil
	}

	branch = strings.TrimSpace(branch)
	if branch == "" || strings.EqualFold(branch, "current") {
		var err error
		branch, err = a.currentBranchName()
		if err != nil {
			return PatternPreview{}, err
		}
	}

	content, err := a.readFileFromBranch(branch, filePath)
	if err != nil {
		return PatternPreview{Status: "file-not-found", Message: "File not found in selected branch"}, nil
	}
	candidates := detectVersionCandidates(content, pattern)
	if len(candidates) == 0 {
		if strings.TrimSpace(pattern) != "" {
			if extractWithPattern(content, pattern) == "INVALID_PATTERN" {
				return PatternPreview{Status: "invalid-pattern", Message: "Invalid regex pattern"}, nil
			}
		}
		return PatternPreview{Status: "no-version", Message: "Version not detected"}, nil
	}
	first := candidates[0]
	formatted := formatVersionOutput(first.Original, branchType, 1, true)
	if formatted == "no-version" {
		return PatternPreview{
			Status:    "no-version",
			Extracted: first.Original,
			Message:   "Could not format next version from extracted value",
		}, nil
	}

	return PatternPreview{
		Status:    "ok",
		Extracted: first.Original,
		Formatted: formatted,
		Message:   fmt.Sprintf("Preview from branch %s", branch),
	}, nil
}

// readFileFromBranch uses `git show` to read a file from a branch without checkout.
func (a *App) readFileFromBranch(branch, file string) (string, error) {
	cmd := gitCommand("-C", a.repoPath, "show", branch+":"+file)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func (a *App) currentBranchName() (string, error) {
	cmd := gitCommand("-C", a.repoPath, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get current branch: %w", err)
	}
	branch := strings.TrimSpace(string(out))
	if branch == "" {
		return "HEAD", nil
	}
	return branch, nil
}

// extractVersion parses the version string from file content based on filename.
func extractVersion(content, filename string) string {
	_ = filename
	return extractWithPattern(content, "")
}

func extractWithPattern(content, pattern string) string {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return autoDetectVersion(content)
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return "INVALID_PATTERN"
	}
	match := re.FindStringSubmatch(content)
	if len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	if len(match) == 1 {
		return strings.TrimSpace(match[0])
	}
	return ""
}

func autoDetectVersion(content string) string {
	// 1) JSON-aware detection for typical {"version": "x.y.z.w"} documents.
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(content), &obj); err == nil {
		for key, value := range obj {
			if strings.EqualFold(strings.TrimSpace(key), "version") {
				if text, ok := value.(string); ok {
					trimmed := strings.TrimSpace(text)
					if trimmed != "" {
						return trimmed
					}
				}
			}
		}
	}

	// 2) Regex against raw content in case JSON is malformed or embedded in text.
	jsonVersion := regexp.MustCompile(`"version"\s*:\s*"([^"]+)"`)
	if match := jsonVersion.FindStringSubmatch(content); len(match) > 1 {
		value := strings.TrimSpace(match[1])
		if value != "" {
			return value
		}
	}

	// 3) Generic numeric version token fallback.
	versionToken := regexp.MustCompile(`\d+(?:\.\d+){3,4}`)
	if token := strings.TrimSpace(versionToken.FindString(content)); token != "" {
		return token
	}

	// 4) Legacy fallback for plain one-line version files.
	return firstLine(content)
}

func firstLine(content string) string {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	parts := strings.Split(normalized, "\n")
	if len(parts) == 0 {
		return "N/A"
	}
	line := strings.TrimSpace(parts[0])
	if line == "" {
		return "N/A"
	}
	return line
}

func formatVersionOutput(rawValue, branchType string, incrementStep int, applyIncrement bool) string {
	rawValue = strings.TrimSpace(rawValue)
	if rawValue == "" || rawValue == "INVALID_PATTERN" {
		return "no-version"
	}
	original, next, ok := computeNextVersion(rawValue, branchType, incrementStep, applyIncrement)
	if !ok {
		return "no-version"
	}
	if !applyIncrement {
		return original
	}
	return fmt.Sprintf("%s -> %s", original, next)
}

func computeNextVersion(rawValue, branchType string, incrementStep int, applyIncrement bool) (string, string, bool) {
	_ = branchType
	re := regexp.MustCompile(`\d+(?:\.\d+)+`)
	token := re.FindString(rawValue)
	if token == "" {
		return "", "", false
	}

	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return "", "", false
	}
	count := len(parts)
	parts = append([]string{}, parts[:count]...)

	widths := make([]int, count)
	numbers := make([]int, count)
	for i := 0; i < count; i++ {
		if i == 0 {
			widths[i] = len(parts[i])
		} else {
			if len(parts[i]) < 2 {
				widths[i] = 2
			} else {
				widths[i] = len(parts[i])
			}
		}
		value := 0
		for _, ch := range parts[i] {
			if ch < '0' || ch > '9' {
				return "", "", false
			}
			value = value*10 + int(ch-'0')
		}
		numbers[i] = value
	}

	original := formatParts(numbers, widths)
	if incrementStep < 1 {
		incrementStep = 1
	}
	if applyIncrement {
		numbers[count-1] += incrementStep
	}
	next := formatParts(numbers, widths)
	return original, next, true
}

func formatCandidate(candidate versionCandidate, incrementStep int, applyIncrement bool) string {
	formatted := formatVersionOutput(candidate.Original, "auto", incrementStep, applyIncrement)
	if formatted == "no-version" {
		return ""
	}
	if candidate.Label == "" {
		return formatted
	}
	return fmt.Sprintf("%s: %s", candidate.Label, formatted)
}

func detectVersionCandidates(content, pattern string) []versionCandidate {
	pattern = strings.TrimSpace(pattern)
	if pattern != "" {
		value := extractWithPattern(content, pattern)
		if value == "" || value == "INVALID_PATTERN" {
			return nil
		}
		return []versionCandidate{{Label: "match", Original: value, Token: value}}
	}

	var root interface{}
	if err := json.Unmarshal([]byte(content), &root); err == nil {
		var candidates []versionCandidate
		collectJSONVersionCandidates(root, "", &candidates)
		if len(candidates) > 0 {
			return dedupeCandidates(candidates)
		}
	}

	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	var candidates []versionCandidate
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if token := findVersionToken(line); token != "" {
			candidates = append(candidates, versionCandidate{
				Label:    fmt.Sprintf("line %d", i+1),
				Original: line,
				Token:    token,
			})
		}
	}
	return dedupeCandidates(candidates)
}

func collectJSONVersionCandidates(node interface{}, path string, out *[]versionCandidate) {
	switch typed := node.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			nextPath := key
			if path != "" {
				nextPath = path + "." + key
			}
			collectJSONVersionCandidates(typed[key], nextPath, out)
		}
	case []interface{}:
		for i, value := range typed {
			nextPath := fmt.Sprintf("%s[%d]", path, i)
			collectJSONVersionCandidates(value, nextPath, out)
		}
	case string:
		token := findVersionToken(typed)
		if token == "" {
			return
		}
		label := path
		if dot := strings.LastIndex(label, "."); dot >= 0 {
			label = label[dot+1:]
		}
		label = strings.TrimSpace(label)
		if label == "" {
			label = "value"
		}
		*out = append(*out, versionCandidate{
			Label:    label,
			Original: strings.TrimSpace(typed),
			Token:    token,
		})
	}
}

func findVersionToken(text string) string {
	versionToken := regexp.MustCompile(`\d+(?:\.\d+)+`)
	return strings.TrimSpace(versionToken.FindString(text))
}

func dedupeCandidates(values []versionCandidate) []versionCandidate {
	seen := map[string]struct{}{}
	result := make([]versionCandidate, 0, len(values))
	for _, value := range values {
		key := strings.ToLower(strings.TrimSpace(value.Label) + "|" + strings.TrimSpace(value.Original))
		if key == "|" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func formatParts(values []int, widths []int) string {
	out := make([]string, len(values))
	for i := range values {
		if i == 0 {
			out[i] = fmt.Sprintf("%d", values[i])
			continue
		}
		out[i] = fmt.Sprintf("%0*d", widths[i], values[i])
	}
	return strings.Join(out, ".")
}

func expectedPartsForBranch(branchType string, detected int) int {
	switch normalizedBranchType(branchType) {
	case "development":
		if detected >= 4 {
			return 4
		}
		return 0
	case "sprint":
		if detected >= 5 {
			return 5
		}
		return 0
	default:
		if detected >= 5 {
			return 5
		}
		if detected >= 4 {
			return 4
		}
		return 0
	}
}

func normalizedBranchType(value string) string {
	v := strings.ToLower(strings.TrimSpace(value))
	if v == "development" || v == "sprint" {
		return v
	}
	return "auto"
}

func (a *App) restoreSession() error {
	user, err := loadCurrentUser()
	if err != nil {
		return err
	}
	a.user = user
	if user == "" {
		return nil
	}
	settings, err := loadUserSettings(user)
	if err != nil {
		return err
	}
	a.repoPath = settings.LastRepo
	return nil
}

func validateUsername(username string) (string, error) {
	name := strings.TrimSpace(username)
	if name == "" {
		return "", errors.New("username is required")
	}
	valid := regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	if !valid.MatchString(name) {
		return "", errors.New("username can contain only letters, numbers, dot, underscore and dash")
	}
	return name, nil
}

func containsPath(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(filepath.Clean(value), filepath.Clean(target)) {
			return true
		}
	}
	return false
}

func appConfigDir() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath)
	configDir := filepath.Join(exeDir, "config")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", err
	}
	return configDir, nil
}

func currentUserFilePath() (string, error) {
	configDir, err := appConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "current_user.txt"), nil
}

func userSettingsPath(username string) (string, error) {
	configDir, err := appConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, username, "settings.json"), nil
}

func userExists(username string) bool {
	settingsPath, err := userSettingsPath(username)
	if err != nil {
		return false
	}
	_, statErr := os.Stat(settingsPath)
	return statErr == nil
}

func ensureUserConfig(username string) error {
	settingsPath, err := userSettingsPath(username)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(settingsPath), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(settingsPath); err == nil {
		return nil
	}
	return saveUserSettings(username, UserSettings{})
}

func loadCurrentUser() (string, error) {
	path, err := currentUserFilePath()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func saveCurrentUser(username string) error {
	path, err := currentUserFilePath()
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(username+"\n"), 0o644)
}

func loadUserSettings(username string) (UserSettings, error) {
	if username == "" {
		return UserSettings{}, nil
	}
	settingsPath, err := userSettingsPath(username)
	if err != nil {
		return UserSettings{}, err
	}
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return UserSettings{}, nil
		}
		return UserSettings{}, err
	}
	if len(data) == 0 {
		return UserSettings{}, nil
	}
	var settings UserSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return UserSettings{}, err
	}
	if settings.Repositories == nil {
		settings.Repositories = []string{}
	}
	if settings.RepoPreferences == nil {
		settings.RepoPreferences = map[string]RepoPreferences{}
	}
	for key, prefs := range settings.RepoPreferences {
		settings.RepoPreferences[key] = normalizeRepoPreferences(prefs)
	}
	return settings, nil
}

func saveUserSettings(username string, settings UserSettings) error {
	if username == "" {
		return errors.New("username is required")
	}
	settingsPath, err := userSettingsPath(username)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(settingsPath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath, data, 0o644)
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func uniqueSources(values []RepoVersionSource) []RepoVersionSource {
	seen := map[string]struct{}{}
	result := make([]RepoVersionSource, 0, len(values))
	for _, source := range values {
		s := source
		s.ID = strings.TrimSpace(s.ID)
		s.Name = strings.TrimSpace(s.Name)
		s.FilePath = filepath.ToSlash(strings.TrimSpace(s.FilePath))
		s.Pattern = strings.TrimSpace(s.Pattern)
		if s.ID == "" {
			s.ID = sanitizeSourceID(s.Name + "-" + s.FilePath)
		}
		if s.Name == "" && s.FilePath != "" {
			s.Name = filepath.Base(s.FilePath)
		}
		if s.Name == "" {
			s.Name = s.ID
		}
		key := strings.ToLower(s.ID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, s)
	}
	return result
}

func normalizeRepoPreferences(prefs RepoPreferences) RepoPreferences {
	prefs.BranchScope = normalizeBranchScope(prefs.BranchScope)
	prefs.SelectedBranches = uniqueStrings(prefs.SelectedBranches)
	prefs.FavoriteBranches = uniqueStrings(prefs.FavoriteBranches)
	prefs.BranchTypes = normalizeBranchTypes(prefs.BranchTypes)

	if prefs.VersionFile != "" && len(prefs.VersionSources) == 0 {
		prefs.VersionSources = []RepoVersionSource{{
			ID:       sanitizeSourceID("default-" + prefs.VersionFile),
			Name:     filepath.Base(prefs.VersionFile),
			FilePath: prefs.VersionFile,
			Pattern:  "",
			Favorite: true,
		}}
	}

	if len(prefs.VersionSources) == 0 {
		prefs.VersionSources = []RepoVersionSource{{
			ID:       "default-package-json",
			Name:     "Package",
			FilePath: "package.json",
			Pattern:  "\"version\"\\s*:\\s*\"([^\"]+)\"",
			Favorite: true,
		}}
	}

	prefs.VersionSources = uniqueSources(prefs.VersionSources)

	if len(prefs.SelectedSourceIDs) == 0 {
		for _, source := range prefs.VersionSources {
			prefs.SelectedSourceIDs = append(prefs.SelectedSourceIDs, source.ID)
		}
	}
	prefs.SelectedSourceIDs = normalizeSelectedSourceIDs(prefs.SelectedSourceIDs, prefs.VersionSources)
	return prefs
}

func normalizeSelectedSourceIDs(selectedIDs []string, sources []RepoVersionSource) []string {
	allowed := map[string]struct{}{}
	for _, source := range sources {
		allowed[strings.ToLower(source.ID)] = struct{}{}
	}
	result := make([]string, 0, len(selectedIDs))
	seen := map[string]struct{}{}
	for _, id := range selectedIDs {
		clean := strings.TrimSpace(id)
		if clean == "" {
			continue
		}
		key := strings.ToLower(clean)
		if _, ok := allowed[key]; !ok {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, clean)
	}
	return result
}

func normalizeBranchTypes(types map[string]string) map[string]string {
	if types == nil {
		return map[string]string{}
	}
	clean := make(map[string]string, len(types))
	for branch, branchType := range types {
		name := strings.TrimSpace(branch)
		if name == "" {
			continue
		}
		clean[name] = normalizedBranchType(branchType)
	}
	return clean
}

func normalizeBranchScope(scope string) string {
	s := strings.ToLower(strings.TrimSpace(scope))
	if s == "local" || s == "remote" || s == "all" {
		return s
	}
	return "all"
}

func sanitizeSourceID(input string) string {
	input = strings.ToLower(strings.TrimSpace(input))
	if input == "" {
		return "source"
	}
	re := regexp.MustCompile(`[^a-z0-9._-]+`)
	id := re.ReplaceAllString(input, "-")
	id = strings.Trim(id, "-")
	if id == "" {
		return "source"
	}
	return id
}

func listUsers() ([]string, error) {
	configDir, err := appConfigDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(configDir)
	if err != nil {
		return nil, err
	}
	var users []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		settingsPath := filepath.Join(configDir, entry.Name(), "settings.json")
		if _, err := os.Stat(settingsPath); err == nil {
			users = append(users, entry.Name())
		}
	}
	sort.Strings(users)
	return users, nil
}
