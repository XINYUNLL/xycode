import json
import os

# The session is just the message list on disk. Save after every turn; load it
# back on --resume. No database — the whole conversation is already a plain list.
SESSION_FILE = os.path.join(os.getcwd(), ".mini-session.json")


#region session
def save_session(messages) -> None:
    try:
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump(messages, f, indent=2, default=lambda o: getattr(o, "model_dump", lambda: str(o))())
    except Exception:
        pass


def load_session():
    if not os.path.exists(SESSION_FILE):
        return None
    try:
        with open(SESSION_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None
#endregion
