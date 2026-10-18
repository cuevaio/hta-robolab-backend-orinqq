import json
import os
from pathlib import Path
import pty
import select
import subprocess
import sys
import termios
import unittest
from open_usb import open_serial


class UsbPortTests(unittest.TestCase):
    def test_raw_usb_has_no_login_echo_and_preserves_utf8(self):
        master, slave = pty.openpty()
        fd = open_serial(os.ttyname(slave))
        try:
            self.assertFalse(termios.tcgetattr(fd)[3] & termios.ECHO)
            payload = '{"objetivo":"niños"}\n'.encode()
            os.write(master, payload)
            self.assertTrue(select.select([fd], [], [], 1)[0])
            self.assertEqual(os.read(fd, 1024), payload)
        finally:
            os.close(fd); os.close(slave); os.close(master)

    def test_real_node_service_identifies_itself_over_a_serial_port(self):
        master, slave = pty.openpty()
        root = Path(__file__).resolve().parents[2]
        child = subprocess.Popen([sys.executable, "-B", str(root / "ops/jetson/open_usb.py"), os.ttyname(slave)], cwd=root, stderr=subprocess.PIPE)
        try:
            # Node tarda brevemente en registrar el lector. El servicio no imprime banners en USB.
            self.assertIn(b'usb_service_ready', child.stderr.readline())
            os.write(master, b'{"v":1,"id":"probe","method":"hello"}\n')
            data = b""
            while b"\n" not in data:
                self.assertTrue(select.select([master], [], [], 10)[0], "Sin respuesta USB")
                data += os.read(master, 65536)
            response = json.loads(data)
            self.assertEqual(response["id"], "probe")
            self.assertEqual(response["result"]["device"], "robolab-jetson")
            self.assertEqual(response["result"]["provider"], "ollama")
        finally:
            child.terminate(); child.communicate(timeout=5)
            os.close(slave); os.close(master)


if __name__ == "__main__":
    unittest.main()
