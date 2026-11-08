package host

import (
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/DnzzL/herdr-automations/internal/config"
)

type concurrentSpace struct {
	sync.Mutex
	tabs         []string
	closed       []string
	firstClosing chan struct{}
	secondRead   chan struct{}
	once         sync.Once
}

func (s *concurrentSpace) read(second bool) []string {
	s.Lock()
	tabs := slices.Clone(s.tabs)
	s.Unlock()
	if second {
		s.once.Do(func() { close(s.secondRead) })
	}
	return tabs
}

func (s *concurrentSpace) closeTab(id string) error {
	if id == "tab1" {
		close(s.firstClosing)
		// Without the workspace lock, the second run can read the same two
		// tabs before this first close acts. With it, that read waits.
		select {
		case <-s.secondRead:
		case <-time.After(100 * time.Millisecond):
		}
	}
	s.Lock()
	defer s.Unlock()
	s.closed = append(s.closed, id)
	s.tabs = slices.DeleteFunc(s.tabs, func(tab string) bool { return tab == id })
	return nil
}

type concurrentHC struct {
	fakeHC
	space  *concurrentSpace
	second bool
}

func (f *concurrentHC) Terminals(map[string]string) ([]string, error) {
	return f.space.read(f.second), nil
}
func (f *concurrentHC) Kill(id string) error { return f.space.closeTab(id) }
func (f *concurrentHC) Rm(string) error      { return nil }

func TestCloseExistingConcurrentRunsLeaveLastVisibleTab(t *testing.T) {
	for _, backend := range []string{"herdr", "hc"} {
		t.Run(backend, func(t *testing.T) {
			space := &concurrentSpace{
				tabs:         []string{"tab1", "tab2"},
				firstClosing: make(chan struct{}), secondRead: make(chan struct{}),
			}
			a := config.Automation{Workspace: config.WorkspaceExisting, WorkspaceID: "shared"}
			var calls [2]func() error
			var fakes []*fakeOps
			for i, id := range []string{"tab1", "tab2"} {
				s := Session{WorkspaceID: "shared", PaneID: id, TabID: id}
				var h Host
				if backend == "hc" {
					h = &hcHost{ops: &concurrentHC{space: space, second: i == 1}}
				} else {
					f := &fakeOps{
						agentStatus: func(string) (string, error) { return "done", nil },
						tabList:     func(string) ([]string, error) { return space.read(i == 1), nil },
						tabClose:    space.closeTab,
					}
					fakes = append(fakes, f)
					h = &live{ops: f}
				}
				calls[i] = func() error { return h.Close(s, a) }
			}
			results := make(chan error, 2)
			go func() { results <- calls[0]() }()
			select {
			case <-space.firstClosing:
			case <-time.After(time.Second):
				t.Fatal("first close did not reach the act")
			}
			go func() { results <- calls[1]() }()
			for range 2 {
				select {
				case err := <-results:
					if err != nil {
						t.Fatal(err)
					}
				case <-time.After(time.Second):
					t.Fatal("concurrent closes did not finish")
				}
			}
			if !slices.Equal(space.closed, []string{"tab1"}) || !slices.Equal(space.tabs, []string{"tab2"}) {
				t.Fatalf("closed=%v remaining=%v, want one close and the last tab left", space.closed, space.tabs)
			}
			for _, f := range fakes {
				if len(f.closed) != 0 {
					t.Fatalf("issued a space close: %v", f.closed)
				}
			}
		})
	}
}
