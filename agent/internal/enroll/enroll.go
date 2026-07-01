// Package enroll performs first-time device registration: it presents a
// one-time enroll token and the device's PUBLIC key to the API, which
// records the machine and returns its machineId. The private key never leaves
// the device.
package enroll

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Request is the enrollment payload.
type Request struct {
	PublicKey    string `json:"publicKey"`
	Name         string `json:"name,omitempty"`
	Hostname     string `json:"hostname,omitempty"`
	Arch         string `json:"arch,omitempty"`
	AgentVersion string `json:"agentVersion,omitempty"`
}

type response struct {
	MachineID string `json:"machineId"`
	Name      string `json:"name"`
	Error     string `json:"error"`
}

// EndpointFromConnectURL derives the HTTP enroll endpoint from the wss connect
// URL: wss://host/connect → https://host/enroll (ws→http for local dev).
func EndpointFromConnectURL(connectURL string) (string, error) {
	u, err := url.Parse(connectURL)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "wss":
		u.Scheme = "https"
	case "ws":
		u.Scheme = "http"
	case "https", "http":
		// already http(s)
	default:
		return "", fmt.Errorf("unsupported scheme %q", u.Scheme)
	}
	// Swap a trailing /connect for /enroll; otherwise append /enroll.
	if strings.HasSuffix(u.Path, "/connect") {
		u.Path = strings.TrimSuffix(u.Path, "/connect") + "/enroll"
	} else {
		u.Path = strings.TrimRight(u.Path, "/") + "/enroll"
	}
	return u.String(), nil
}

// Do registers the device and returns the assigned machineId.
func Do(ctx context.Context, endpoint, enrollToken string, req Request) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+enrollToken)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	var r response
	_ = json.Unmarshal(raw, &r)

	if resp.StatusCode != http.StatusCreated {
		if r.Error != "" {
			return "", fmt.Errorf("enroll failed (%d): %s", resp.StatusCode, r.Error)
		}
		return "", fmt.Errorf("enroll failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if r.MachineID == "" {
		return "", fmt.Errorf("enroll succeeded but no machineId returned")
	}
	return r.MachineID, nil
}
