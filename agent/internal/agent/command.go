package agent

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// Hooks may spawn descendants holding output pipes. Cancellation kills their
// process group; WaitDelay also bounds inherited-pipe drain after parent exit.
type agentProcess struct{ *exec.Cmd }

func (command *agentProcess) finish(err error) error {
	if err != nil && command.ProcessState != nil {
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
	return err
}
func (command *agentProcess) Run() error  { return command.finish(command.Cmd.Run()) }
func (command *agentProcess) Wait() error { return command.finish(command.Cmd.Wait()) }

func agentCommand(ctx context.Context, name string, args ...string) *agentProcess {
	command := exec.CommandContext(ctx, name, args...)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.WaitDelay = 2 * time.Second
	command.Cancel = func() error {
		err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	return &agentProcess{command}
}
