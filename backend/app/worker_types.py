from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class WorkerClaim:
    job_id: str
    started_at: datetime
