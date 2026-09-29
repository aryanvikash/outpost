//go:build !unix

package client

func diskUsage(string) (uint64, uint64) { return 0, 0 }
