// Package protocol defines the Outpost wire protocol in Go.
//
// It mirrors PROTOCOL.md (the source of truth) and api/src/protocol.ts.
// Keep all three in sync. Protocol version: 1.
package protocol

import "encoding/json"

// Version is the current protocol version.
const Version = 1

// MaxMessageBytes is the maximum application message size (1 MiB).
const MaxMessageBytes = 1024 * 1024

// Message types (the "type" field).
const (
	TypeHello     = "hello"
	TypeHeartbeat = "heartbeat"
	TypeLog       = "log"
	TypeResult    = "result"
	TypeAck       = "ack"
	TypeJob       = "job"
	TypeCancel    = "cancel"
	TypeWelcome   = "welcome"
)

// Synthetic agent-level exit codes (see PROTOCOL.md §4).
const (
	ExitTimeout     = 124 // job exceeded timeoutSec
	ExitStartFailed = 125 // agent could not start the action
	ExitRefused     = 126 // allowlist / param validation rejection
	ExitTerminated  = 130 // canceled / killed
)

// Envelope is the common header on every message; used to peek at the type.
type Envelope struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
}

// --- Agent → API ---------------------------------------------------

// DeployConfig describes where the deploy action operates on this host. Reported
// so the API / UI can show the target; never accepted from the wire.
type DeployConfig struct {
	AppDir    string `json:"appDir"`
	Remote    string `json:"remote"`
	RepoURL   string `json:"repoUrl,omitempty"`
	PM2Target string `json:"pm2Target"`
	Mode      string `json:"mode,omitempty"`     // "hook" | "pm2"
	HookPath  string `json:"hookPath,omitempty"` // set when Mode == "hook"
}

// Hello announces the agent and its supported action allowlist. No credential is
// included; the device proved its identity by signing the connect JWT (§2.2).
type Hello struct {
	Type         string        `json:"type"`
	Version      int           `json:"version"`
	MachineID    string        `json:"machineId"`
	AgentVersion string        `json:"agentVersion"`
	Actions      []string      `json:"actions"`
	Deploy       *DeployConfig `json:"deploy,omitempty"`
	Hooks        []string      `json:"hooks,omitempty"`
	// HookIssues lists files in the hooks dir that look like intended hooks but
	// are NOT runnable, with the reason — so the UI can surface the problem
	// instead of silently ignoring them.
	HookIssues []HookIssue `json:"hookIssues,omitempty"`
}

// HookIssue describes a hook file that exists but can't be run, and why.
type HookIssue struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// HostStats is best-effort host telemetry sent with heartbeats.
type HostStats struct {
	UptimeSec  uint64  `json:"uptimeSec,omitempty"`
	Load1      float64 `json:"load1,omitempty"`
	MemUsedMb  uint64  `json:"memUsedMb,omitempty"`
	MemTotalMb uint64  `json:"memTotalMb,omitempty"`
}

// Heartbeat is a periodic liveness ping.
type Heartbeat struct {
	Type    string     `json:"type"`
	Version int        `json:"version"`
	TS      int64      `json:"ts"`
	Stats   *HostStats `json:"stats,omitempty"`
}

// Log is a streamed chunk of job output.
type Log struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	JobID   string `json:"jobId"`
	Stream  string `json:"stream"` // "stdout" | "stderr"
	Seq     int    `json:"seq"`
	Chunk   string `json:"chunk"`
}

// Result is the terminal message for a job.
type Result struct {
	Type       string `json:"type"`
	Version    int    `json:"version"`
	JobID      string `json:"jobId"`
	ExitCode   int    `json:"exitCode"`
	FinishedAt int64  `json:"finishedAt"`
	Error      string `json:"error,omitempty"`
}

// Ack acknowledges receipt of a job.
type Ack struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	JobID   string `json:"jobId"`
}

// --- API → agent ---------------------------------------------------

// Job is a unit of work: a named action plus validated params. Never a command.
type Job struct {
	Type       string          `json:"type"`
	Version    int             `json:"version"`
	JobID      string          `json:"jobId"`
	Action     string          `json:"action"`
	Params     json.RawMessage `json:"params"`
	TimeoutSec int             `json:"timeoutSec"`
}

// Cancel requests cancellation of an in-flight job.
type Cancel struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	JobID   string `json:"jobId"`
}

// Welcome is the server's optional ack of Hello.
type Welcome struct {
	Type         string `json:"type"`
	Version      int    `json:"version"`
	HeartbeatSec int    `json:"heartbeatSec"`
	ServerTime   int64  `json:"serverTime"`
}

// --- constructors ------------------------------------------------------------

// NewLog builds a Log message.
func NewLog(jobID, stream string, seq int, chunk string) Log {
	return Log{Type: TypeLog, Version: Version, JobID: jobID, Stream: stream, Seq: seq, Chunk: chunk}
}

// NewResult builds a Result message.
func NewResult(jobID string, exitCode int, finishedAt int64, errStr string) Result {
	return Result{Type: TypeResult, Version: Version, JobID: jobID, ExitCode: exitCode, FinishedAt: finishedAt, Error: errStr}
}

// NewAck builds an Ack message.
func NewAck(jobID string) Ack {
	return Ack{Type: TypeAck, Version: Version, JobID: jobID}
}
