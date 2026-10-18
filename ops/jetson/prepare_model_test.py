import contextlib
import http.server
import json
import threading
import unittest
from prepare_model import prepare_model

MODEL = "qwen2.5:3b-instruct-q4_K_M"

@contextlib.contextmanager
def ollama_server(missing=False, gpu=True, temporary_failure=False, redirect=False):
    calls = []
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def reply(self, value, status=200):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(value).encode())
        def do_GET(self):
            calls.append((self.path, None))
            if self.path == "/api/tags":
                if redirect:
                    self.send_response(302)
                    self.send_header("Location", "http://example.invalid/api/tags")
                    self.end_headers()
                    return
                if temporary_failure and len(calls) == 1:
                    return self.reply({}, 503)
                return self.reply({"models": [] if missing else [{"name": MODEL, "digest": "abc"}]})
            return self.reply({"models": [{"name": MODEL, "size": 2400, "size_vram": 2400 if gpu else 0, "context_length": 8192}]})
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((self.path, body))
            self.reply({"done": True})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

class PrepareModelTests(unittest.TestCase):
    def test_loads_local_model_and_reports_actual_gpu(self):
        with ollama_server() as (url, calls):
            result = prepare_model(url, MODEL, retry_seconds=0)
        self.assertEqual([path for path, _ in calls], ["/api/tags", "/api/generate", "/api/ps"])
        self.assertEqual(calls[1][1], {"model": MODEL, "stream": False, "keep_alive": "10m", "options": {"num_ctx": 8192}})
        self.assertEqual(result["event"], "model_ready")
        self.assertEqual(result["gpuPercent"], 100)
        self.assertEqual(result["model"], MODEL)
        self.assertEqual(result["digest"], "abc")
    def test_missing_model_does_not_download_or_call_cloud(self):
        with ollama_server(missing=True) as (url, calls):
            with self.assertRaisesRegex(RuntimeError, "descargado"):
                prepare_model(url, MODEL, retry_seconds=0)
        self.assertEqual(calls, [("/api/tags", None)])
    def test_cpu_fallback_is_not_reported_as_gpu_ready(self):
        with ollama_server(gpu=False) as (url, _):
            with self.assertRaisesRegex(RuntimeError, "GPU"):
                prepare_model(url, MODEL, retry_seconds=0)
    def test_refuses_redirects_outside_loopback(self):
        with ollama_server(redirect=True) as (url, _):
            with self.assertRaisesRegex(RuntimeError, "redirección"):
                prepare_model(url, MODEL, attempts=1, retry_seconds=0)

    def test_retries_while_ollama_starts(self):
        with ollama_server(temporary_failure=True) as (url, calls):
            result = prepare_model(url, MODEL, retry_seconds=0)
        self.assertEqual(result["gpuPercent"], 100)
        self.assertEqual(sum(path == "/api/tags" for path, _ in calls), 2)

if __name__ == "__main__":
    unittest.main()
