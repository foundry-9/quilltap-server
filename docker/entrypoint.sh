#!/bin/sh
# Quilltap Docker entrypoint script
# Optionally sets up port forwarding from container localhost to Docker host,
# then execs the application so it becomes PID 1 and receives signals properly.

if [ -n "$HOST_REDIRECT_PORTS" ]; then
  # Verify host.docker.internal is resolvable (use nslookup from BusyBox on Alpine)
  if ! nslookup host.docker.internal >/dev/null 2>&1; then
    echo "WARNING: host.docker.internal does not resolve."
    echo "  On Linux, add --add-host=host.docker.internal:host-gateway to docker run."
    echo "  On macOS/Windows, ensure Docker Desktop is running."
    echo "  Port forwarding will be attempted but may fail."
  else
    echo "Verified: host.docker.internal resolves successfully"
  fi

  # Parse and set up socat forwarders for each port
  for port in $(echo "$HOST_REDIRECT_PORTS" | tr ',' ' '); do
    # Trim whitespace
    port=$(echo "$port" | tr -d '[:space:]')
    if [ -n "$port" ]; then
      echo "Forwarding localhost:${port} -> host.docker.internal:${port}"

      # IPv4 listener (primary)
      socat TCP4-LISTEN:${port},fork,reuseaddr TCP:host.docker.internal:${port} &

      # IPv6 listener (for Node.js 22+ dual-stack localhost resolution on Alpine)
      socat TCP6-LISTEN:${port},fork,reuseaddr TCP:host.docker.internal:${port} 2>/dev/null &
    fi
  done

  # Let socat listeners initialize before the app starts connecting
  sleep 0.5

  # Verify listeners are running (pidof available on Alpine/BusyBox)
  if pidof socat >/dev/null 2>&1; then
    echo "Port forwarding active"
  else
    echo "WARNING: No socat listeners running. Port forwarding may have failed."
    echo "  Check that the requested ports are not already in use."
  fi
fi

exec "$@"
