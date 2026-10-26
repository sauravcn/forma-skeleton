"""Run the included local API without installing a private/shared package."""

import os
from pathlib import Path
from starter_api.server import main

if __name__ == "__main__":
    os.environ.setdefault(
        "DATABASE_PATH", str(Path(__file__).parent / "data/records.sqlite3")
    )
    main()
