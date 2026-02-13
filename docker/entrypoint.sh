#!/bin/sh
# Quilltap Docker entrypoint script
# Optionally sets up port forwarding from container localhost to Docker host,
# then execs the application so it becomes PID 1 and receives signals properly.

if [ -n "$HOST_REDIRECT_PORTS" ]; then
  IFS=',' read -r dummy <<EOF
$HOST_REDIRECT_PORTS
EOF
  # Parse and set up socat forwarders for each port
  for port in $(echo "$HOST_REDIRECT_PORTS" | tr ',' ' '); do
    # Trim whitespace
    port=$(echo "$port" | tr -d '[:space:]')
    if [ -n "$port" ]; then
      echo "Redirecting localhost:${port} → host.docker.internal:${port}"
      socat TCP-LISTEN:${port},fork,reuseaddr TCP:host.docker.internal:${port} &
    fi
  done
fi

exec "$@"
