# Backend: Django

Django receives a report request from the page and returns calculated results.

- `urls.py` matches the page address or API address.
- `views.py` checks the requested dates, chooses a report and returns JSON.
- `repository.py` runs the fixed, read-only SQL files and caches aggregates locally.
- `config.py` contains local server settings.
- `manage.py` starts Django or runs its built-in checks.

The backend calls the functions in `logic` for date rules and arithmetic. Database connection details stay here; the browser receives aggregate results only.
