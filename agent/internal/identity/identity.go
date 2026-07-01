// Package identity manages the device's Ed25519 keypair.
//
// The private key is generated ON the device and never leaves it. The API
// stores only the public key (registered at enrollment). On every connect
// the agent proves its identity by signing a short-lived EdDSA JWT, which the
// API verifies against the stored public key — no shared secret ever
// crosses the wire.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// ConnectAudience must match the API's expected audience.
const ConnectAudience = "outpost-connect"

// Identity wraps a device private key.
type Identity struct {
	priv ed25519.PrivateKey
}

// Generate creates a fresh Ed25519 device identity.
func Generate() (*Identity, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &Identity{priv: priv}, nil
}

// Load reads a private key previously written by Save.
func Load(path string) (*Identity, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("key file %s must be mode 0600 (is %o)", path, info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	dec, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil {
		return nil, fmt.Errorf("key file is not valid base64: %w", err)
	}
	if len(dec) != ed25519.PrivateKeySize {
		return nil, errors.New("key file is not a valid Ed25519 private key")
	}
	return &Identity{priv: ed25519.PrivateKey(dec)}, nil
}

// Save writes the private key to path with mode 0600 (refuses to clobber).
func Save(id *Identity, path string) error {
	enc := base64.StdEncoding.EncodeToString(id.priv)
	// O_EXCL so we never overwrite an existing device key.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(enc + "\n")
	return err
}

// PublicKeyBase64 returns the base64 (std) of the 32-byte public key, as sent
// to the API at enrollment.
func (id *Identity) PublicKeyBase64() string {
	pub := id.priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}

// SignConnectJWT builds and signs a short-lived EdDSA JWT for the connect
// handshake (lifetime ~60s).
func (id *Identity) SignConnectJWT(machineID string, now time.Time) (string, error) {
	header := map[string]string{"alg": "EdDSA", "typ": "JWT", "kid": machineID}
	payload := map[string]any{
		"iss": machineID,
		"iat": now.Unix(),
		"exp": now.Add(60 * time.Second).Unix(),
		"aud": ConnectAudience,
	}
	hb, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	pb, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	signingInput := b64url(hb) + "." + b64url(pb)
	sig := ed25519.Sign(id.priv, []byte(signingInput))
	return signingInput + "." + b64url(sig), nil
}

func b64url(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}
