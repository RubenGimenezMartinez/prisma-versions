package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx      context.Context
	repoPath string
}

// BranchVersion holds a branch name and its detected version.
type BranchVersion struct {
	Branch  string `json:"branch"`
	Version string `json:"version"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// SetRepoPath validates that path is a git repository and stores it.
func (a *App) SetRepoPath(path string) error {
	path = filepath.Clean(path)
	cmd := exec.Command("git", "-C", path, "rev-parse", "--git-dir")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("not a valid git repository: %s", path)
	}
	a.repoPath = path
	return nil
}

// GetRepoPath returns the currently configured repository path.
func (a *App) GetRepoPath() string {
	return a.repoPath
}

// GetBranches returns the list of local branch names for the configured repository.
func (a *App) GetBranches() ([]string, error) {
	if a.repoPath == "" {
		return nil, fmt.Errorf("no repository configured")
	}
	cmd := exec.Command("git", "-C", a.repoPath, "branch", "--format=%(refname:short)")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var branches []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			branches = append(branches, line)
		}
	}
	return branches, nil
}

// GetBranchVersions reads versionFile from every local branch and returns
// a slice of BranchVersion with the extracted version string (or "N/A").
func (a *App) GetBranchVersions(versionFile string) ([]BranchVersion, error) {
	if a.repoPath == "" {
		return nil, fmt.Errorf("no repository configured")
	}
	if versionFile == "" {
		versionFile = "package.json"
	}
	branches, err := a.GetBranches()
	if err != nil {
		return nil, err
	}
	var results []BranchVersion
	for _, branch := range branches {
		content, err := a.readFileFromBranch(branch, versionFile)
		if err != nil {
			results = append(results, BranchVersion{Branch: branch, Version: "N/A"})
			continue
		}
		version := extractVersion(content, versionFile)
		results = append(results, BranchVersion{Branch: branch, Version: version})
	}
	return results, nil
}

// readFileFromBranch uses `git show` to read a file from a branch without checkout.
func (a *App) readFileFromBranch(branch, file string) (string, error) {
	cmd := exec.Command("git", "-C", a.repoPath, "show", branch+":"+file)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// extractVersion parses the version string from file content based on filename.
func extractVersion(content, filename string) string {
	base := filepath.Base(filename)
	switch base {
	case "package.json":
		var pkg map[string]interface{}
		if err := json.Unmarshal([]byte(content), &pkg); err == nil {
			if v, ok := pkg["version"].(string); ok {
				return v
			}
		}
	case "pom.xml":
		re := regexp.MustCompile(`<version>([^<]+)</version>`)
		if m := re.FindStringSubmatch(content); len(m) > 1 {
			return strings.TrimSpace(m[1])
		}
	}
	// Fallback: return trimmed raw content (e.g. VERSION, version.txt)
	return strings.TrimSpace(content)
}
