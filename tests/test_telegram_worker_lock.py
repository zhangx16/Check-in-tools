import fcntl
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from telegram_worker_lock import worker_lock

class WorkerLockTest(unittest.TestCase):
    def test_direct_worker_lock_excludes_another_open_description(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/"run.lock"
            with worker_lock(file):
                fd=os.open(str(file)+".flock",os.O_RDWR)
                try:
                    with self.assertRaises(BlockingIOError):fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                finally:os.close(fd)
            with worker_lock(file):pass

    def test_inherited_node_descriptor_keeps_parent_exclusion(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/"run.lock";fd=os.open(str(file)+".flock",os.O_CREAT|os.O_RDWR,0o600)
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.dict(os.environ,{"CHECKIN_LOCK_FD":str(os.dup(fd))}):
                with worker_lock(file):pass
            separate=os.open(str(file)+".flock",os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):fcntl.flock(separate,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(separate);os.close(fd)
