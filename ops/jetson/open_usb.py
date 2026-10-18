#!/usr/bin/env python3
"""Dedica el ACM USB al protocolo; no interpreta comandos del dispositivo remoto."""
import os
import sys
import termios
import tty


def open_serial(path):
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        tty.setraw(fd)
        attrs = termios.tcgetattr(fd)
        attrs[2] |= termios.CLOCAL | termios.CREAD | termios.HUPCL
        attrs[4] = attrs[5] = termios.B115200
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        return fd
    except BaseException:
        os.close(fd)
        raise


if __name__ == "__main__":
    device = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyGS0"
    descriptor = open_serial(device)
    os.dup2(descriptor, 0)
    os.dup2(descriptor, 1)
    if descriptor > 1:
        os.close(descriptor)
    os.execv("/usr/bin/node", ["node", "--import", "tsx", "scripts/agent-usb.ts"])
