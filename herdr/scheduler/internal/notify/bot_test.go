package notify

import (
	"errors"
	"reflect"
	"testing"
)

type fakeBotHC struct {
	live    map[string][]string
	listErr error
	sendErr error
	asked   []map[string]string
	sent    [][2]string
}

func (f *fakeBotHC) Terminals(labels map[string]string) ([]string, error) {
	f.asked = append(f.asked, labels)
	return f.live[labels["bot"]], f.listErr
}

func (f *fakeBotHC) Send(address, text string) error {
	f.sent = append(f.sent, [2]string{address, text})
	return f.sendErr
}

func TestABotIsFoundByItsLabelAndSentTo(t *testing.T) {
	h := &fakeBotHC{live: map[string][]string{"b-captain": {"t7"}}}
	terminal, err := BotsWith(h).Send("b-captain", "[automation check] done: ok")
	if err != nil || terminal != "t7" {
		t.Fatalf("got %q, %v", terminal, err)
	}
	if !reflect.DeepEqual(h.asked, []map[string]string{{"bot": "b-captain"}}) {
		t.Fatalf("asked hc for %v", h.asked)
	}
	if !reflect.DeepEqual(h.sent, [][2]string{{"t7", "[automation check] done: ok"}}) {
		t.Fatalf("sent %v", h.sent)
	}
}

func TestANameNoTerminalIsLabelledWithIsTriedAsATerminalName(t *testing.T) {
	h := &fakeBotHC{}
	terminal, err := BotsWith(h).Send("captain", "x")
	if err != nil || terminal != "captain" || h.sent[0][0] != "captain" {
		t.Fatalf("got %q, %v, sent %v", terminal, err, h.sent)
	}
}

func TestAReportThatCannotBeSentSaysWhy(t *testing.T) {
	h := &fakeBotHC{sendErr: errors.New("hc send: blocked")}
	if _, err := BotsWith(h).Send("captain", "x"); err == nil || err.Error() != "hc send: blocked" {
		t.Fatalf("got %v", err)
	}
	h = &fakeBotHC{listErr: errors.New("no server")}
	if _, err := BotsWith(h).Send("captain", "x"); err == nil || len(h.sent) != 0 {
		t.Fatalf("an hc that cannot list was still sent to: %v, %v", err, h.sent)
	}
}
