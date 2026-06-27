package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultRepo = "aryanvikash/outpost"

// runUpdate implements `outpost-agent update`: download the latest (or a pinned)
// release for this OS/arch from GitHub Releases, verify its SHA-256 against
// checksums.txt, atomically replace the running binary, and restart the service.
// Replacing an in-use binary is safe on Linux: rename() swaps the directory entry
// while the running process keeps its open inode; the new binary takes effect on
// the next start (the restart below).
func runUpdate(args []string) error {
	fs := flag.NewFlagSet("update", flag.ExitOnError)
	target := fs.String("version", "", "version to install (e.g. v0.1.2); default: latest")
	force := fs.Bool("force", false, "reinstall even if already on the target version")
	noRestart := fs.Bool("no-restart", false, "replace the binary but do not restart the service")
	repo := fs.String("repo", envOr("OUTPOST_REPO", defaultRepo), "github owner/repo")
	_ = fs.Parse(args)

	ver := *target
	if ver == "" {
		v, err := latestVersion(*repo)
		if err != nil {
			return fmt.Errorf("resolve latest release: %w", err)
		}
		ver = v
	}
	if ver == version && !*force {
		fmt.Printf("already up to date (%s)\n", version)
		return nil
	}

	// Replacing /usr/local/bin and restarting the service both need root.
	if os.Geteuid() != 0 {
		return fmt.Errorf("must run as root: sudo outpost-agent update")
	}

	self, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(self); err == nil {
		self = resolved
	}

	fmt.Printf("updating %s -> %s (%s/%s)\n", version, ver, runtime.GOOS, runtime.GOARCH)
	bin, err := downloadBinary(*repo, ver)
	if err != nil {
		return err
	}
	defer os.Remove(bin)

	// Atomic replace: stage alongside the target, then rename over it.
	staged := filepath.Join(filepath.Dir(self), ".outpost-agent.new")
	if err := copyFileMode(bin, staged, 0o755); err != nil {
		return fmt.Errorf("stage new binary: %w", err)
	}
	if err := os.Rename(staged, self); err != nil {
		os.Remove(staged)
		return fmt.Errorf("replace %s: %w", self, err)
	}
	fmt.Printf("installed %s at %s\n", ver, self)

	if *noRestart {
		fmt.Println("not restarting (--no-restart); apply with: systemctl restart outpost-agent")
		return nil
	}
	if _, err := exec.LookPath("systemctl"); err == nil {
		if err := exec.Command("systemctl", "restart", "outpost-agent").Run(); err != nil {
			fmt.Printf("note: restart it manually — systemctl restart outpost-agent (%v)\n", err)
		} else {
			fmt.Println("restarted outpost-agent")
		}
	}
	return nil
}

func latestVersion(repo string) (string, error) {
	resp, err := httpDo(fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.TagName == "" {
		return "", fmt.Errorf("no tag_name in latest release")
	}
	return out.TagName, nil
}

// downloadBinary fetches and verifies the release asset, returning a temp path to
// the extracted outpost-agent binary (caller removes it).
func downloadBinary(repo, ver string) (string, error) {
	verNoV := strings.TrimPrefix(ver, "v")
	asset := fmt.Sprintf("outpost-agent_%s_%s_%s.tar.gz", verNoV, runtime.GOOS, runtime.GOARCH)
	base := fmt.Sprintf("https://github.com/%s/releases/download/%s", repo, ver)

	tarball, err := httpGetTemp(base + "/" + asset)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", asset, err)
	}
	defer os.Remove(tarball)

	sums, err := httpGetBytes(base + "/checksums.txt")
	if err != nil {
		return "", fmt.Errorf("download checksums: %w", err)
	}
	expected := checksumFor(string(sums), asset)
	if expected == "" {
		return "", fmt.Errorf("no checksum entry for %s", asset)
	}
	actual, err := sha256File(tarball)
	if err != nil {
		return "", err
	}
	if actual != expected {
		return "", fmt.Errorf("checksum mismatch: expected %s got %s", expected, actual)
	}
	return extractBinary(tarball, "outpost-agent")
}

func extractBinary(tarball, name string) (string, error) {
	f, err := os.Open(tarball)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		if hdr.Typeflag != tar.TypeReg || filepath.Base(hdr.Name) != name {
			continue
		}
		out, err := os.CreateTemp("", "outpost-agent-*")
		if err != nil {
			return "", err
		}
		if _, err := io.Copy(out, tr); err != nil { //nolint:gosec // size bounded by release asset
			out.Close()
			os.Remove(out.Name())
			return "", err
		}
		out.Close()
		return out.Name(), nil
	}
	return "", fmt.Errorf("%q not found in archive", name)
}

func httpDo(url string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "outpost-agent-updater")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return resp, nil
}

func httpGetTemp(url string) (string, error) {
	resp, err := httpDo(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	tmp, err := os.CreateTemp("", "outpost-dl-*")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", err
	}
	tmp.Close()
	return tmp.Name(), nil
}

func httpGetBytes(url string) ([]byte, error) {
	resp, err := httpDo(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func checksumFor(sums, asset string) string {
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == asset {
			return fields[0]
		}
	}
	return ""
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func copyFileMode(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chmod(dst, mode)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
