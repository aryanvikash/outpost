//go:build unix

package client

import "syscall"

func diskUsage(path string) (total, used uint64) {
	var st syscall.Statfs_t
	if syscall.Statfs(path, &st) != nil {
		return 0, 0
	}
	bs := uint64(st.Bsize)
	total = st.Blocks * bs / (1 << 20)
	return total, total - st.Bavail*bs/(1<<20)
}
