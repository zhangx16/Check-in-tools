"""Linux advisory lock shared with Node; automatically released on process death."""
import fcntl
import os
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def worker_lock(directory):
    file = Path(str(directory) + ".flock")
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    inherited = os.environ.get("CHECKIN_LOCK_FD")
    fd = int(inherited) if inherited else os.open(file, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if inherited and os.fstat(fd).st_ino != file.stat().st_ino:
            raise RuntimeError("Invalid inherited Telegram lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Telegram worker lock is busy") from None
        yield
    finally:
        # Do not unlock a borrowed fd: Node retains exclusion until child close.
        os.close(fd)
