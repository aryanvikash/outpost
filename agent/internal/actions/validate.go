package actions

import (
	"regexp"
	"strings"
)

// Param validation. The agent is the authoritative validator. Validated params
// are only ever passed to commands via argv (never a shell), but we still
// constrain them tightly so a bug downstream can't be coerced into something
// unexpected (e.g. an option-injection via a leading '-').

var (
	branchRe = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,255}$`)
	appRe    = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
)

func validBranch(s string) bool {
	if !branchRe.MatchString(s) {
		return false
	}
	if strings.HasPrefix(s, "-") { // no option injection
		return false
	}
	if strings.Contains(s, "..") { // no path traversal / git revspec tricks
		return false
	}
	return true
}

func validApp(s string) bool {
	return appRe.MatchString(s) && !strings.HasPrefix(s, "-")
}
