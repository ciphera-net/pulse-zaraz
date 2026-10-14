#!/usr/bin/env python3
"""Tiny origin server for the verify harness's fixture site.

Not `python3 -m http.server`: that module's MIME guessing is not reliable
across Python versions for `.json` (some map it to `application/octet-stream`),
and this harness's non-HTML case specifically depends on a correct
`Content-Type` — WebCM (and Zaraz) decide whether to touch a response at all
by sniffing `text/html` in the response's content type, so a wrong type here
would make the "non-HTML gets no tag" case pass for the wrong reason.
"""
import http.server
import os

SITE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            path = "/index.html"
        file_path = os.path.join(SITE_DIR, path.lstrip("/"))
        ext = os.path.splitext(file_path)[1]
        content_type = CONTENT_TYPES.get(ext)
        if content_type is None or not os.path.isfile(file_path):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"not found")
            return
        with open(file_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # keep verify.sh's output readable; errors still raise


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    http.server.HTTPServer(("0.0.0.0", port), Handler).serve_forever()
