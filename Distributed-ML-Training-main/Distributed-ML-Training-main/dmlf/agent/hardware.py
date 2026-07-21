import psutil
import socket
import subprocess
import os
import ipaddress

def get_hostname() -> str:
    return socket.gethostname()

def get_ip_address() -> str:
    # Multi-adapter Windows machines often route the probe below through a
    # VPN, virtual switch, or WSL interface. DDP needs an address actually
    # owned by the LAN adapter, so allow each agent to advertise it explicitly.
    override = os.environ.get('DMLF_ADVERTISE_IP', '').strip()
    if override:
        try:
            ipaddress.ip_address(override)
            return override
        except ValueError as error:
            raise RuntimeError('DMLF_ADVERTISE_IP must be a valid IPv4 or IPv6 address') from error
    # Gets the local IP that would connect to external networks
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def get_cpu_count() -> int:
    return psutil.cpu_count(logical=True)

def get_ram_total() -> str:
    total_bytes = psutil.virtual_memory().total
    gb = total_bytes / (1024 ** 3)
    return f"{gb:.1f}GB"

def get_gpu_model() -> str:
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if lines:
                return lines[0] # Returns the first GPU model
    except FileNotFoundError:
        pass
    return "None"
