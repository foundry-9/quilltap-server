#!/bin/sh
# Quilltap Docker entrypoint script
# Execs the application so it becomes PID 1 and receives signals properly.

exec "$@"
