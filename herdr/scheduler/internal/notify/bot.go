package notify

import (
	"fmt"

	"github.com/DnzzL/herdr-automations/internal/hc"
)

// Messenger delivers one line to a bot, and says which terminal took it.
type Messenger interface {
	Send(bot, text string) (terminal string, err error)
}

// botHC is the part of hc a report needs, so the tests need no herdr-core.
type botHC interface {
	Terminals(labels map[string]string) ([]string, error)
	Send(address, text string) error
}

// Bots reports to bots the way bots report to each other: find the bot's live
// terminal by its label (`hc ls --label bot=<id>`), then `hc send` to it. The
// automation names a bot, never an address, because addresses change on every
// restart. A name no terminal is labelled with is tried as a terminal's own
// name, which hc send also takes.
type Bots struct{ hc botHC }

// NewBots returns the Messenger over the real hc.
func NewBots() Bots { return Bots{hc: hc.Client{}} }

// BotsWith returns a Messenger over h, the tests' seam.
func BotsWith(h botHC) Bots { return Bots{hc: h} }

func (b Bots) Send(bot, text string) (string, error) {
	target := bot
	live, err := b.hc.Terminals(map[string]string{"bot": bot})
	if err != nil {
		return "", fmt.Errorf("looking for %s: %w", bot, err)
	}
	if len(live) > 0 {
		target = live[0]
	}
	if err := b.hc.Send(target, text); err != nil {
		return "", err
	}
	return target, nil
}
