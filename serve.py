#!/usr/bin/env python3
"""Serve only a bundled game. Use --lan to allow phones on the same local network."""
from __future__ import annotations
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import tempfile
from build import build


def local_ipv4() -> list[str]:
    addresses: set[str] = set()
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            address = result[4][0]
            if not address.startswith('127.'):
                addresses.add(address)
    except OSError:
        pass
    # UDP connect selects a local route; no packet is sent to this documentation address.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('192.0.2.1', 9))
            address = probe.getsockname()[0]
            if not address.startswith('127.'):
                addresses.add(address)
    except OSError:
        pass
    return sorted(addresses)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lan', action='store_true', help='Allow devices on your local network to access the game.')
    parser.add_argument('--port', type=int, default=8080, help='HTTP port, default: 8080')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    with tempfile.TemporaryDirectory(prefix='contraption-mobile-') as directory:
        build(Path(directory) / 'index.html')
        handler = partial(SimpleHTTPRequestHandler, directory=directory)
        try:
            server = ThreadingHTTPServer((host, args.port), handler)
        except OSError as exc:
            raise SystemExit(f'Cannot start server: {exc}. Try --port 8081.') from exc
        with server:
            print(f'Computer: http://localhost:{args.port}', flush=True)
            if args.lan:
                print('Phone: connect to the same Wi-Fi and open ONE of these addresses:', flush=True)
                ips = local_ipv4()
                for ip in ips:
                    print(f'  http://{ip}:{args.port}', flush=True)
                if not ips:
                    print(f'  http://<computer-LAN-IP>:{args.port}  (check network settings)', flush=True)
                print('Only the generated game is served, not your source folder. Do not expose this server to the public internet.', flush=True)
            print('Keep this window open. Press Ctrl+C to stop.', flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print('\nStopped.', flush=True)


if __name__ == '__main__':
    main()
