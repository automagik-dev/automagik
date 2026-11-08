//go:build !unix

package host

import "fmt"

func (herdrOps) AgentStop(string) (bool, error) {
	return true, fmt.Errorf("asking a foreground process group to stop is unsupported on this platform")
}
