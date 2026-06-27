package client

import (
	"testing"
	"time"
)

func TestNextBackoffDoublesAndCaps(t *testing.T) {
	d := backoffInitial
	prev := d
	for i := 0; i < 20; i++ {
		d = nextBackoff(d)
		if d < prev && d != backoffMax {
			t.Fatalf("backoff went backwards: %v -> %v", prev, d)
		}
		if d > backoffMax {
			t.Fatalf("backoff exceeded cap: %v > %v", d, backoffMax)
		}
		prev = d
	}
	if d != backoffMax {
		t.Errorf("expected backoff to saturate at %v, got %v", backoffMax, d)
	}
}

func TestWithJitterStaysInRange(t *testing.T) {
	d := 10 * time.Second
	for i := 0; i < 1000; i++ {
		j := withJitter(d)
		if j < d/2 || j > d {
			t.Fatalf("jitter out of [d/2, d]: %v", j)
		}
	}
}
