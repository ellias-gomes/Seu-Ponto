#!/usr/bin/env python3
"""
Servidor Local Multiplataforma - Seu Ponto
==========================================
Compatível nativamente com:
- Windows 11 (Notebook corporativo, sem admin, com VPN ativa)
- Linux / Pop!_OS (Desktop/Notebook pessoal)

Características:
- 100% biblioteca padrão do Python (Zero 'pip install')
- Não requer privilégios de Administrador / root
- Roda em 127.0.0.1 (não bloqueado por VPNs corporativas)
- Detecta interfaces locais (Ethernet, Wi-Fi, VPNs tun/tap/WireGuard)
- Abre automaticamente no navegador padrão (Chrome, Edge, Firefox, Brave)
"""

import http.server
import socketserver
import socket
import json
import os
import sys
import platform
import getpass
import subprocess
import webbrowser

PORTA = 8000
DIRETORIO_BASE = os.path.dirname(os.path.abspath(__file__))

def obter_nome_sistema():
    """Identifica com precisão se é Windows 11, Pop!_OS ou outra distribuição Linux."""
    sis = platform.system()
    if sis == "Linux":
        try:
            info = platform.freedesktop_os_release()
            pretty = info.get("PRETTY_NAME")
            if pretty:
                return pretty
        except Exception:
            pass
        return f"Linux ({platform.release()})"
    elif sis == "Windows":
        try:
            ver_parts = platform.version().split(".")
            build = int(ver_parts[-1])
            if build >= 22000:
                return f"Windows 11 (Build {build})"
            return f"Windows 10 (Build {build})"
        except Exception:
            return f"Windows {platform.release()}"
    return f"{sis} {platform.release()}"

def obter_ips_e_interfaces():
    """Extrai IPs locais de todas as interfaces ativas (incluindo placas de VPN no Linux e Windows)."""
    interfaces = {}
    ips = set()

    # 1. No Linux (Pop!_OS, Ubuntu, Debian, etc.), usa 'ip' para mapear cada adaptador
    if platform.system() == "Linux":
        try:
            out = subprocess.check_output(
                ["ip", "-o", "-4", "addr", "show"],
                text=True,
                stderr=subprocess.DEVNULL
            )
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 4:
                    iface = parts[1]
                    ip = parts[3].split("/")[0]
                    if not ip.startswith("127."):
                        interfaces[iface] = ip
                        ips.add(ip)
        except Exception:
            pass

    # 2. Resolução via Hostname (Comum em Windows e fallbacks)
    try:
        hostname = socket.gethostname()
        _, _, ip_list = socket.gethostbyname_ex(hostname)
        for ip in ip_list:
            if not ip.startswith("127."):
                ips.add(ip)
                if not any(ip == v for v in interfaces.values()):
                    interfaces[f"host_{len(interfaces)+1}"] = ip
    except Exception:
        pass

    # 3. Rota de saída padrão (UDP dummy)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("8.8.8.8", 80))
        ip_rota = s.getsockname()[0]
        if not ip_rota.startswith("127."):
            ips.add(ip_rota)
            if not any(ip_rota == v for v in interfaces.values()):
                interfaces["rota_padrao"] = ip_rota
        s.close()
    except Exception:
        pass

    return list(ips), interfaces

class PontoHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRETORIO_BASE, **kwargs)

    def do_GET(self):
        if self.path == "/api/sysinfo":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            hostname = socket.gethostname()
            ips_locais, ifaces = obter_ips_e_interfaces()
            try:
                usuario = getpass.getuser()
            except Exception:
                usuario = os.environ.get("USER") or os.environ.get("USERNAME", "Usuario")

            dados = {
                "status": "ok",
                "hostname": hostname,
                "usuario": usuario,
                "sistema_operacional": obter_nome_sistema(),
                "ips_locais": ips_locais,
                "interfaces": ifaces,
                "arquitetura": platform.machine()
            }
            self.wfile.write(json.dumps(dados, ensure_ascii=False).encode("utf-8"))
            return

        return super().do_GET()

    def end_headers(self):
        # Desativa cache para garantir atualizações imediatas
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

def encontrar_porta_livre(porta_inicial=8000, max_tentativas=20):
    for p in range(porta_inicial, porta_inicial + max_tentativas):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return porta_inicial

class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

def main():
    porta = encontrar_porta_livre(PORTA)
    url = f"http://127.0.0.1:{porta}"
    so_nome = obter_nome_sistema()
    ips, _ = obter_ips_e_interfaces()

    print("=" * 65)
    print("  SEU PONTO - SERVIDOR LOCAL MULTIPLATAFORMA")
    print("=" * 65)
    print(f"  Sistema:   {so_nome} ({platform.machine()})")
    print(f"  Diretório: {DIRETORIO_BASE}")
    print(f"  URL Local: {url}")
    print(f"  Hostname:  {socket.gethostname()}")
    print(f"  IPs Rede:  {', '.join(ips) or '127.0.0.1'}")
    print("=" * 65)
    print("  Pressione Ctrl+C para encerrar o servidor.")
    print("=" * 65)

    # Abre o navegador padrão (no Linux usa xdg-open / navegador configurado)
    try:
        webbrowser.open(url)
    except Exception:
        pass

    with ReuseTCPServer(("127.0.0.1", porta), PontoHTTPHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor encerrado.")

if __name__ == "__main__":
    main()
