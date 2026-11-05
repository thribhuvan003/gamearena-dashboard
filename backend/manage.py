import os
import sys
from pathlib import Path

# Make the project folders available without copying logic into the backend.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.config")

from django.core.management import execute_from_command_line

# Run the selected Django command, such as check or runserver.
execute_from_command_line(sys.argv)
