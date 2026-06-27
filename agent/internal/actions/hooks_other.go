//go:build !unix

package actions

import "os"

func hookOwnedByAgent(_ os.FileInfo) bool { return false }
