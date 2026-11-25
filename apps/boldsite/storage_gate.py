import logging
from contextlib import contextmanager
from time import monotonic, sleep


class StorageBusy(Exception):
    """The SQLite file is already in use by another request."""


@contextmanager
def exclusive_storage(path, *, timeout=3):
    """Serialise SQLite access on a shared filesystem using an atomic directory create."""
    deadline = monotonic() + timeout
    while True:
        try:
            path.mkdir()
        except FileExistsError as error:
            if monotonic() >= deadline:
                raise StorageBusy("另一个请求正在使用项目存储，请稍后重试") from error
            sleep(0.05)
        else:
            break

    try:
        yield
    finally:
        try:
            path.rmdir()
        except OSError:
            # The transaction may have committed. Do not report its write as failed on unlock.
            logging.getLogger(__name__).exception("Could not release the SQLite storage gate")
