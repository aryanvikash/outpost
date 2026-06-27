package client

import (
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/aryanvikash/outpost/agent/internal/config"
	"github.com/aryanvikash/outpost/agent/internal/identity"
)

// authHeaders builds the upgrade-request headers. The device signs a short-lived
// EdDSA JWT with its private key (PROTOCOL.md §2); no shared secret is sent.
func authHeaders(cfg config.Config, id *identity.Identity, agentVersion string) (http.Header, error) {
	jwt, err := id.SignConnectJWT(cfg.MachineID, time.Now())
	if err != nil {
		return nil, err
	}
	h := http.Header{}
	h.Set("Authorization", "Bearer "+jwt)
	h.Set("X-Outpost-Agent-Version", agentVersion)
	h.Set("X-Outpost-Machine-Id", cfg.MachineID)
	return h, nil
}

// buildHTTPClient returns the HTTP client used for the wss dial. If
// OUTPOST_TLS_PIN is set (base64 SHA-256 of the server cert's SubjectPublicKeyInfo)
// the leaf certificate is pinned, defending against a compromised CA.
func buildHTTPClient() (*http.Client, error) {
	pin := os.Getenv("OUTPOST_TLS_PIN")
	if pin == "" {
		return http.DefaultClient, nil
	}
	want, err := base64.StdEncoding.DecodeString(pin)
	if err != nil {
		return nil, fmt.Errorf("OUTPOST_TLS_PIN is not valid base64: %w", err)
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			VerifyConnection: func(cs tls.ConnectionState) error {
				if len(cs.PeerCertificates) == 0 {
					return fmt.Errorf("no peer certificate to pin")
				}
				leaf := cs.PeerCertificates[0]
				sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
				if !equalBytes(sum[:], want) {
					return fmt.Errorf("tls pin mismatch")
				}
				return nil
			},
		},
	}
	return &http.Client{Transport: tr}, nil
}

func equalBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := range a {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
