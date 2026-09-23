import os

# A skill is a reusable prompt template in .mini-skills/<name>.md. Typing
# "/commit ..." loads it and runs its prompt (with any extra text appended) as
# if you'd typed the whole thing — install-and-use like a shell script.
SKILLS_DIR = os.path.join(os.getcwd(), ".mini-skills")


#region skill
def resolve_skill(text):
    if not text.startswith("/"):
        return None
    name, _, rest = text[1:].partition(" ")
    path = os.path.join(SKILLS_DIR, f"{name}.md")
    if not os.path.exists(path):
        return None
    prompt = open(path, encoding="utf-8").read().strip()
    args = rest.strip()
    return f"{prompt}\n\n{args}" if args else prompt
#endregion
