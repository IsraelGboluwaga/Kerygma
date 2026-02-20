"""Shared utility functions."""


def format_timestamp(seconds: float) -> str:
    """Convert seconds to MM:SS format.

    Args:
        seconds: Time in seconds

    Returns:
        Formatted timestamp string (e.g., "62:15")
    """
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"
