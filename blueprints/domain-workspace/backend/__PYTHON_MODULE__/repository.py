"""UNFINISHED domain extension. Replace hooks; retain shared transaction/auth plumbing."""
from pathlib import Path
from forma_sdk.workspace import Database, Problem

class Repository(Database):
    tables = ()

    def __init__(self, path):
        super().__init__(path, Path(__file__).parent / "migrations")

    @staticmethod
    def authorize_operation(principal, method, resource, ident, data, *, preview=False):
        # Fail closed until the app supplies its reviewed human/agent role policy.
        raise Problem("commands.error.unconfigured", 503)

    def apply(self, connection, method, resource, ident, data):
        raise Problem("ops.error.notImplemented", 501)
