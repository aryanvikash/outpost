// Package client implements the agent's outbound connection to the control
// plane: dial wss, authenticate, heartbeat, execute jobs, stream logs, and
// reconnect with exponential backoff + jitter on any drop.
//
// The reconnect loop is the most important part: if the agent isn't connected,
// the box is unreachable (it has no inbound ports).
package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/aryanvikash/outpost/agent/internal/actions"
	"github.com/aryanvikash/outpost/agent/internal/config"
	"github.com/aryanvikash/outpost/agent/internal/identity"
	"github.com/aryanvikash/outpost/agent/internal/protocol"
)

const (
	backoffInitial = 1 * time.Second
	backoffMax     = 60 * time.Second
)

// Client owns the lifecycle of a single agent connection.
type Client struct {
	cfg          config.Config
	id           *identity.Identity
	agentVersion string
	log          *slog.Logger
	heartbeat    time.Duration

	writeMu sync.Mutex
	conn    *websocket.Conn

	jobsMu sync.Mutex
	jobs   map[string]context.CancelFunc
}

// New creates a Client. id is the device identity used to sign the connect JWT.
func New(cfg config.Config, id *identity.Identity, agentVersion string, log *slog.Logger) *Client {
	return &Client{
		cfg:          cfg,
		id:           id,
		agentVersion: agentVersion,
		log:          log,
		heartbeat:    30 * time.Second,
		jobs:         make(map[string]context.CancelFunc),
	}
}

// Run connects and serves forever, reconnecting with backoff until ctx is done.
func (c *Client) Run(ctx context.Context) error {
	backoff := backoffInitial
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		start := time.Now()
		err := c.connectAndServe(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// A connection that lasted a while is "healthy"; reset backoff.
		if time.Since(start) > 2*c.heartbeat {
			backoff = backoffInitial
		}
		c.log.Warn("disconnected, will reconnect", "err", err, "backoff", backoff)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(withJitter(backoff)):
		}
		backoff = nextBackoff(backoff)
	}
}

func (c *Client) connectAndServe(ctx context.Context) error {
	dialCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	httpClient, err := buildHTTPClient()
	if err != nil {
		return fmt.Errorf("tls config: %w", err)
	}

	header, err := authHeaders(c.cfg, c.id, c.agentVersion)
	if err != nil {
		return fmt.Errorf("sign connect assertion: %w", err)
	}
	opts := &websocket.DialOptions{
		HTTPClient: httpClient,
		HTTPHeader: header,
	}
	conn, _, err := websocket.Dial(dialCtx, c.cfg.ControlPlaneURL, opts)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	conn.SetReadLimit(protocol.MaxMessageBytes)
	c.setConn(conn)
	defer func() {
		c.setConn(nil)
		conn.Close(websocket.StatusNormalClosure, "bye")
	}()

	c.log.Info("connected", "url", c.cfg.ControlPlaneURL)

	// Serve under a connection-scoped context so heartbeats and jobs stop when
	// the socket dies.
	connCtx, connCancel := context.WithCancel(ctx)
	defer connCancel()

	if err := c.sendHello(connCtx); err != nil {
		return fmt.Errorf("hello: %w", err)
	}

	go c.heartbeatLoop(connCtx)
	go c.keepaliveLoop(connCtx, conn, connCancel)

	return c.readLoop(connCtx, conn)
}

func (c *Client) readLoop(ctx context.Context, conn *websocket.Conn) error {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var env protocol.Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			c.log.Warn("bad message", "err", err)
			continue
		}
		switch env.Type {
		case protocol.TypeJob:
			var job protocol.Job
			if err := json.Unmarshal(data, &job); err != nil {
				c.log.Warn("bad job message", "err", err)
				continue
			}
			go c.runJob(ctx, job)
		case protocol.TypeCancel:
			var cm protocol.Cancel
			if err := json.Unmarshal(data, &cm); err == nil {
				c.cancelJob(cm.JobID)
			}
		case protocol.TypeWelcome:
			var w protocol.Welcome
			if err := json.Unmarshal(data, &w); err == nil && w.HeartbeatSec > 0 {
				c.heartbeat = time.Duration(w.HeartbeatSec) * time.Second
				c.log.Info("server welcome", "heartbeatSec", w.HeartbeatSec)
			}
		default:
			c.log.Warn("unknown message type", "type", env.Type)
		}
	}
}

// runJob executes one job: ack, run the allowlisted action with a timeout,
// stream logs, then send a result.
func (c *Client) runJob(parent context.Context, job protocol.Job) {
	action, ok := actions.Lookup(job.Action)
	if !ok {
		c.log.Warn("refused unknown action", "action", job.Action, "jobId", job.JobID)
		c.sendResult(parent, job.JobID, protocol.ExitRefused, "unknown action: "+job.Action)
		return
	}

	_ = c.send(parent, protocol.NewAck(job.JobID))

	timeout := time.Duration(job.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	jobCtx, cancel := context.WithTimeout(parent, timeout)
	c.registerJob(job.JobID, cancel)
	defer c.unregisterJob(job.JobID)
	defer cancel()

	emit := c.makeEmitter(parent, job.JobID)
	c.log.Info("running job", "jobId", job.JobID, "action", job.Action)

	exitCode, err := action.Handle(jobCtx, job.Params, emit)

	errStr := ""
	if err != nil {
		var refused actions.ErrRefused
		if errors.As(err, &refused) {
			exitCode = protocol.ExitRefused
		}
		errStr = err.Error()
		c.log.Warn("job error", "jobId", job.JobID, "err", err, "exitCode", exitCode)
	}
	c.sendResult(parent, job.JobID, exitCode, errStr)
	c.log.Info("job finished", "jobId", job.JobID, "exitCode", exitCode)
}

// makeEmitter returns a LogFunc that assigns per-stream sequence numbers and
// frames each chunk as a protocol Log over the socket.
func (c *Client) makeEmitter(ctx context.Context, jobID string) actions.LogFunc {
	var mu sync.Mutex
	seq := map[string]int{"stdout": 0, "stderr": 0}
	return func(stream, chunk string) {
		mu.Lock()
		s := seq[stream]
		seq[stream] = s + 1
		mu.Unlock()
		_ = c.send(ctx, protocol.NewLog(jobID, stream, s, chunk))
	}
}

func (c *Client) heartbeatLoop(ctx context.Context) {
	t := time.NewTicker(c.heartbeat)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			hb := protocol.Heartbeat{
				Type:    protocol.TypeHeartbeat,
				Version: protocol.Version,
				TS:      time.Now().UnixMilli(),
				Stats:   hostStats(),
			}
			if err := c.send(ctx, hb); err != nil {
				return
			}
		}
	}
}

// keepaliveLoop detects a dead peer. It sends a WebSocket ping every heartbeat
// interval and treats a missing pong as a dropped connection: on a half-open
// socket (killed without a TCP FIN) readLoop would otherwise block for ~2h on
// OS keepalive, so a ping that isn't ponged within one interval trips here and
// we cancel the connection to let Run's reconnect loop take over.
//
// Ping/pong is handled at the WebSocket runtime layer — Cloudflare answers pings
// even while the MachineDO is hibernated — so an idle-but-healthy connection is
// never falsely dropped. The pong is delivered through the concurrent readLoop,
// which must be running for Ping to complete.
func (c *Client) keepaliveLoop(ctx context.Context, conn *websocket.Conn, cancel context.CancelFunc) {
	interval := c.heartbeat
	if interval <= 0 {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pingCtx, pingCancel := context.WithTimeout(ctx, interval)
			err := conn.Ping(pingCtx)
			pingCancel()
			if err != nil {
				if ctx.Err() != nil {
					return // connection already shutting down
				}
				c.log.Warn("keepalive ping failed, dropping connection", "err", err)
				cancel()
				return
			}
		}
	}
}

func (c *Client) sendHello(ctx context.Context) error {
	deploy := actions.DeployInfo()
	hello := protocol.Hello{
		Type:         protocol.TypeHello,
		Version:      protocol.Version,
		MachineID:    c.cfg.MachineID,
		AgentVersion: c.agentVersion,
		Actions:      actions.Names(),
		Deploy:       &deploy,
		Hooks:        actions.ListHooks(),
		HookIssues:   actions.ListHookIssues(),
	}
	return c.send(ctx, hello)
}

func (c *Client) sendResult(ctx context.Context, jobID string, exitCode int, errStr string) {
	_ = c.send(ctx, protocol.NewResult(jobID, exitCode, time.Now().UnixMilli(), errStr))
}

// send serializes a message and writes it under the write mutex (coder/websocket
// requires writes to be serialized).
func (c *Client) send(ctx context.Context, msg any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	if len(data) > protocol.MaxMessageBytes {
		return fmt.Errorf("message exceeds max size (%d bytes)", len(data))
	}
	c.writeMu.Lock()
	conn := c.conn
	c.writeMu.Unlock()
	if conn == nil {
		return errors.New("not connected")
	}
	writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, data)
}

func (c *Client) setConn(conn *websocket.Conn) {
	c.writeMu.Lock()
	c.conn = conn
	c.writeMu.Unlock()
}

func (c *Client) registerJob(id string, cancel context.CancelFunc) {
	c.jobsMu.Lock()
	c.jobs[id] = cancel
	c.jobsMu.Unlock()
}

func (c *Client) unregisterJob(id string) {
	c.jobsMu.Lock()
	delete(c.jobs, id)
	c.jobsMu.Unlock()
}

func (c *Client) cancelJob(id string) {
	c.jobsMu.Lock()
	cancel, ok := c.jobs[id]
	c.jobsMu.Unlock()
	if ok {
		c.log.Info("canceling job", "jobId", id)
		cancel()
	}
}

// --- backoff -----------------------------------------------------------------

func nextBackoff(d time.Duration) time.Duration {
	d *= 2
	if d > backoffMax {
		return backoffMax
	}
	return d
}

// withJitter applies full jitter: a random duration in [d/2, d].
func withJitter(d time.Duration) time.Duration {
	half := d / 2
	return half + time.Duration(rand.Int63n(int64(half)+1))
}
