"""Small cross-runtime exclusion boundary; no Telegram protocol logic lives here."""
import json
import os
import uuid
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def worker_lock(directory):
    directory = Path(directory)
    directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    owner_file = directory / "owner.json"
    token = uuid.uuid4().hex
    owned = False
    try:
        try:
            directory.mkdir(mode=0o700)
            owned = True
            owner_file.write_text(json.dumps({"pid": os.getpid(), "token": token}))
            owner_file.chmod(0o600)
        except FileExistsError:
            try:
                owner = json.loads(owner_file.read_text())
            except (OSError, ValueError):
                raise RuntimeError("Telegram worker lock is busy") from None
            # Node owns the lock throughout child shutdown; direct timer runs own theirs.
            if owner.get("pid") != os.getppid():
                raise RuntimeError("Telegram worker lock is busy")
        yield
    finally:
        if owned:
            try:
                if json.loads(owner_file.read_text()).get("token") == token:
                    owner_file.unlink()
                    directory.rmdir()
            except FileNotFoundError:
                pass
