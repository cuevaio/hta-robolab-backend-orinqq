#!/usr/bin/env python3
"""Prepara un modelo instalado. Solo HTTP loopback; sin descargas al arrancar."""
import datetime
import json
import os
from pathlib import Path
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fp.close()
        raise RuntimeError("Ollama devolvió una redirección; se rechaza para mantener HTTP loopback.")


def read_json(base_url, path, body=None, timeout=3):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base_url + path, data=data, headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=timeout) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise RuntimeError("La respuesta de Ollama es demasiado grande.")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise RuntimeError("Respuesta de Ollama no válida.")
    return value


def prepare_model(base_url, model, attempts=12, retry_seconds=2):
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RuntimeError("Ollama debe escuchar en HTTP loopback (127.0.0.1).")
    base_url = base_url.rstrip("/")
    started = time.monotonic()
    tags = None
    for attempt in range(attempts):
        try:
            tags = read_json(base_url, "/api/tags")
            break
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            if attempt + 1 == attempts:
                raise RuntimeError("Ollama no respondió durante el arranque.") from None
            time.sleep(retry_seconds)
    installed = next((m for m in (tags or {}).get("models", []) if m.get("name") == model), None)
    if installed is None:
        raise RuntimeError(f"El modelo no está descargado. Ejecuta: ollama pull {model}")
    loaded = read_json(base_url, "/api/generate", {"model": model, "stream": False, "keep_alive": "10m", "options": {"num_ctx": 8192}}, timeout=240)
    if loaded.get("done") is not True:
        raise RuntimeError("La carga del modelo quedó incompleta.")
    running = read_json(base_url, "/api/ps")
    active = next((m for m in running.get("models", []) if m.get("name") == model), None)
    if active is None:
        raise RuntimeError("Ollama no confirmó el modelo cargado.")
    size, vram = active.get("size", 0), active.get("size_vram", 0)
    gpu_percent = int(100 * min(vram, size) / size) if size > 0 else 0
    if gpu_percent != 100:
        raise RuntimeError(f"El modelo no quedó completamente en GPU ({gpu_percent} %). Revisa los registros de Ollama.")
    boot_path = Path("/proc/sys/kernel/random/boot_id")
    return {
        "event": "model_ready", "at": datetime.datetime.now().astimezone().isoformat(),
        "host": socket.gethostname(), "bootId": boot_path.read_text().strip() if boot_path.exists() else None,
        "model": model, "digest": active.get("digest", installed.get("digest")), "gpuPercent": gpu_percent,
        "context": active.get("context_length"), "durationMs": round((time.monotonic() - started) * 1000),
    }


if __name__ == "__main__":
    try:
        result = prepare_model(os.environ.get("ROBOLAB_OLLAMA_URL", "http://127.0.0.1:11434"), os.environ.get("ROBOLAB_MODEL", "qwen2.5:3b-instruct-q4_K_M"))
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"event": "model_not_ready", "error": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        sys.exit(1)
