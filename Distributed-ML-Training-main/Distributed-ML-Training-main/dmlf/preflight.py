"""Network and hardware preflight for a DMLF node agent.

Run this on every additional device before starting ``dmlf.agent.agent``.
It does not register or change cluster state.
"""

import argparse
import json
import socket
import sys

from dmlf.agent import hardware


def split_address(value: str):
    host, separator, port = value.rpartition(":")
    if not separator or not host or not port.isdigit():
        raise ValueError("Manager address must use HOST:PORT, for example 192.168.1.10:50051")
    return host, int(port)


def main():
    parser = argparse.ArgumentParser(description="Check whether a device can join a DMLF manager.")
    parser.add_argument("--manager", required=True, help="DMLF manager address, e.g. 192.168.1.10:50051")
    args = parser.parse_args()
    try:
        host, port = split_address(args.manager)
        with socket.create_connection((host, port), timeout=5):
            reachable = True
        result = {
            "reachable": reachable,
            "manager": args.manager,
            "node": {
                "hostname": hardware.get_hostname(),
                "ipAddress": hardware.get_ip_address(),
                "cpuCount": hardware.get_cpu_count(),
                "gpuModel": hardware.get_gpu_model(),
                "ramTotal": hardware.get_ram_total(),
            },
            "nextCommand": f"python -m dmlf.agent.agent --manager {args.manager}",
        }
        print(json.dumps(result, indent=2))
    except (OSError, ValueError) as error:
        print(json.dumps({"reachable": False, "manager": args.manager, "error": str(error)}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
