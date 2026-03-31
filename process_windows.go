//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideProcessWindow prevents console popups when running git commands on Windows.
func hideProcessWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
}
