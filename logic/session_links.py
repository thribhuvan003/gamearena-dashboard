from urllib.parse import urlsplit


def session_url(template, session_id):
    # Never guess the production route or emit links containing embedded credentials.
    if template.count("{session_id}") != 1:
        return None
    url = template.replace("{session_id}", str(session_id))
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return None
    return url
