package identity

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGenerateSaveLoadRoundTrip(t *testing.T) {
	id, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "agent.key")
	if err := Save(id, p); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("key written with mode %o, want 0600", info.Mode().Perm())
	}
	loaded, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.PublicKeyBase64() != id.PublicKeyBase64() {
		t.Error("loaded key does not match saved key")
	}
}

func TestSaveRefusesToClobber(t *testing.T) {
	id, _ := Generate()
	p := filepath.Join(t.TempDir(), "agent.key")
	if err := Save(id, p); err != nil {
		t.Fatal(err)
	}
	if err := Save(id, p); err == nil {
		t.Fatal("expected Save to refuse overwriting an existing key")
	}
}

func TestLoadRejectsWorldReadableKey(t *testing.T) {
	id, _ := Generate()
	p := filepath.Join(t.TempDir(), "agent.key")
	if err := Save(id, p); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(p, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(p); err == nil {
		t.Fatal("expected Load to reject a group/world-readable key file")
	}
}

// The connect JWT must verify against the public key the control plane stores.
func TestSignConnectJWTVerifies(t *testing.T) {
	id, _ := Generate()
	machineID := "m_test"
	now := time.Unix(1_700_000_000, 0)

	jwt, err := id.SignConnectJWT(machineID, now)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("jwt has %d parts, want 3", len(parts))
	}

	// Verify the signature with the public key, exactly as the server will.
	pubRaw, err := base64.StdEncoding.DecodeString(id.PublicKeyBase64())
	if err != nil {
		t.Fatal(err)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	signingInput := parts[0] + "." + parts[1]
	if !ed25519.Verify(ed25519.PublicKey(pubRaw), []byte(signingInput), sig) {
		t.Error("connect JWT signature did not verify against the public key")
	}
}

func TestPublicKeyIs32Bytes(t *testing.T) {
	id, _ := Generate()
	raw, err := base64.StdEncoding.DecodeString(id.PublicKeyBase64())
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) != ed25519.PublicKeySize {
		t.Errorf("public key is %d bytes, want %d", len(raw), ed25519.PublicKeySize)
	}
}
