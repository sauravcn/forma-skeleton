"""Explicit fresh owned-domain-store migration; no implicit runtime DDL."""

import os
from repository import Repository

if __name__ == "__main__":
    try:
        Repository(
            os.environ["DATABASE_PATH"],
            os.environ["FORMA_APP_ID"],
            os.environ["FORMA_ORGANIZATION_ID"],
        ).migrate()
    except Exception:
        raise SystemExit(
            "Domain migration refused; check owned scope and immutable migration source"
        )
    print("Owned authenticated domain store migration complete")
