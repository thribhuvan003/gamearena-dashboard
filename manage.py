"""Django's command runner, e.g. `python manage.py runserver` or `python manage.py check`."""
import os
import sys

from django.core.management import execute_from_command_line

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "api.config")

# Run the selected Django command, such as check or runserver.
execute_from_command_line(sys.argv)
