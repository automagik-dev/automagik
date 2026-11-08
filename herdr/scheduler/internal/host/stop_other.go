//go:build !unix

package host

import "fmt"

func (herdrOps) AgentEnd(string) error {
	return fmt.Errorf("ending a foreground process group is unsupported on this platform")
}
